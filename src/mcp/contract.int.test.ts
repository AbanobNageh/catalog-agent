import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogClient } from '../catalog/client.js';
import { createLogger } from '../log.js';
import { BASE_URL, KEYS } from '../testing/fixtures.js';
import { connect } from '../testing/mcp.js';
import { createServer } from './server.js';

// The contract check (§4.5): our tools' schemas, as the model sees them in
// tools/list, against catalog-api v1.1.0's own OpenAPI document (/docs-json,
// the source of truth). It fails when a bound, an enum or a field drifts.

interface JsonSchema {
  type?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  $ref?: string;
  items?: JsonSchema;
}

interface OpenApi {
  paths: Record<
    string,
    Record<
      string,
      { parameters?: { name: string; in: string; schema: JsonSchema }[] }
    >
  >;
  components: { schemas: Record<string, JsonSchema> };
}

/** The constraints compared, per parameter. */
const KEYS_COMPARED = [
  'type',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'enum',
] as const;

/**
 * Where a tool is stricter than the API on purpose. Anything else must match
 * exactly. Each entry: [parameter, constraint, ours, the API's].
 */
const DELIBERATE: [string, (typeof KEYS_COMPARED)[number], unknown, unknown][] =
  [
    // An empty string filters nothing; the API accepts it, we don't.
    ['q', 'minLength', 1, undefined],
    ['category', 'minLength', 1, undefined],
    ['brand', 'minLength', 1, undefined],
    // page × size ≤ 10,000 with size ≥ 1: no page past 10,000 can be fetched.
    ['page', 'maximum', 10_000, 2_147_483_647],
  ];

/** Parameters a tool adds that aren't catalog-api's. */
const OWN_PARAMETERS = new Set(['includeFacets']);

let api: OpenApi;
let tools: Map<string, { input: JsonSchema; output: JsonSchema }>;
let client: Client;

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/docs-json`);
  expect(res.ok).toBe(true);
  api = (await res.json()) as OpenApi;

  // In-process: only tools/list is needed, so the catalog client is never called.
  const catalog = new CatalogClient({
    baseUrl: BASE_URL,
    apiKey: KEYS.read,
    timeoutMs: 1000,
    logger: createLogger({ write: () => {} }),
  });
  client = await connect('legacy', () =>
    createServer({
      client: catalog,
      logger: createLogger({ write: () => {} }),
    }),
  );
  const listed = await client.listTools();
  tools = new Map(
    listed.tools.map((t) => [
      t.name,
      {
        input: t.inputSchema as JsonSchema,
        output: (t.outputSchema ?? {}) as JsonSchema,
      },
    ]),
  );
});

afterAll(() => client?.close());

/** The query parameters of an API operation, by name. */
function queryParameters(path: string): Map<string, JsonSchema> {
  const parameters = api.paths[path]?.get?.parameters ?? [];
  return new Map(
    parameters.filter((p) => p.in === 'query').map((p) => [p.name, p.schema]),
  );
}

function component(name: string): JsonSchema {
  const schema = api.components.schemas[name];
  expect(schema, `components.schemas.${name}`).toBeDefined();
  return schema as JsonSchema;
}

/** Every difference between a tool's parameters and the API's, minus the deliberate ones. */
function drift(tool: string, apiParams: Map<string, JsonSchema>): string[] {
  const ours = tools.get(tool)?.input.properties ?? {};
  const problems: string[] = [];
  for (const [name, schema] of Object.entries(ours)) {
    if (OWN_PARAMETERS.has(name)) continue;
    const theirs = apiParams.get(name);
    if (!theirs) {
      problems.push(`${tool}.${name}: not a catalog-api parameter`);
      continue;
    }
    for (const key of KEYS_COMPARED) {
      const a = schema[key];
      const b = theirs[key];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const allowed = DELIBERATE.some(
        ([p, k, o, t]) =>
          p === name &&
          k === key &&
          JSON.stringify(o) === JSON.stringify(a) &&
          JSON.stringify(t) === JSON.stringify(b),
      );
      if (!allowed) {
        problems.push(
          `${tool}.${name}.${key}: ours ${JSON.stringify(a)}, catalog-api ${JSON.stringify(b)}`,
        );
      }
    }
  }
  return problems;
}

/** Our output type can hold the API's: the same, or our integer for its number. */
function compatible(ours: string | undefined, theirs: string | undefined) {
  return ours === theirs || (ours === 'integer' && theirs === 'number');
}

describe('contract with catalog-api v1.1.0 (/docs-json)', () => {
  it('lists the three tools it compares (a missing tool must not pass by default)', () => {
    expect([...tools.keys()].sort()).toEqual([
      'get_product',
      'list_facets',
      'search_products',
    ]);
  });

  it('search_products takes every search parameter, with the same bounds and enums', () => {
    const params = queryParameters('/products/search');
    expect(params.size).toBeGreaterThan(0);
    const ours = Object.keys(
      tools.get('search_products')?.input.properties ?? {},
    );
    for (const name of params.keys()) {
      expect(ours, `search_products is missing ${name}`).toContain(name);
    }
    expect(drift('search_products', params)).toEqual([]);
  });

  it("list_facets' filters are search parameters, with the same bounds", () => {
    expect(drift('list_facets', queryParameters('/products/search'))).toEqual(
      [],
    );
  });

  it('get_product reads GET /products/{id}', () => {
    const parameters = api.paths['/products/{id}']?.get?.parameters ?? [];
    expect(parameters.map((p) => `${p.in}:${p.name}`)).toEqual(['path:id']);
    expect(tools.get('get_product')?.input.required).toEqual(['id']);
  });

  it('every output field taken from the API is one it always returns, with a type we can hold', () => {
    const own = new Set(['price']); // formatted by us
    const check = (output: JsonSchema | undefined, apiName: string) => {
      const api = component(apiName);
      const properties = Object.entries(output?.properties ?? {});
      expect(
        properties.length,
        `${apiName}: no fields compared`,
      ).toBeGreaterThan(0);
      for (const [field, schema] of properties) {
        if (own.has(field)) continue;
        expect(
          api.required ?? [],
          `${apiName} doesn't always return ${field}`,
        ).toContain(field);
        const theirs = api.properties?.[field]?.type;
        expect(
          compatible(schema.type, theirs),
          `${apiName}.${field}: ours ${schema.type}, catalog-api ${theirs}`,
        ).toBe(true);
      }
    };
    const search = tools.get('search_products')?.output;
    check(search?.properties?.hits?.items, 'SearchHitResponse');
    check(tools.get('get_product')?.output, 'ProductResponse');
  });

  it('the search result has the hits, total and facets we read', () => {
    const result = component('SearchResultResponse');
    expect(result.required?.sort()).toEqual(['facets', 'hits', 'total']);
    expect(compatible('integer', result.properties?.total?.type)).toBe(true);
  });

  it('get_product returns every field of the API product (the full product)', () => {
    const ours = Object.keys(tools.get('get_product')?.output.properties ?? {});
    for (const field of Object.keys(
      component('ProductResponse').properties ?? {},
    )) {
      expect(ours, `get_product drops ${field}`).toContain(field);
    }
  });

  it('the facets we map are the ones the API returns', () => {
    expect(component('FacetsResponse').required?.sort()).toEqual([
      'brand',
      'category',
      'price',
    ]);
    expect(component('BucketResponse').required?.sort()).toEqual([
      'count',
      'key',
    ]);
    expect(
      Object.keys(component('PriceBucketResponse').properties ?? {}).sort(),
    ).toEqual(['count', 'from', 'key', 'to']);
  });
});
