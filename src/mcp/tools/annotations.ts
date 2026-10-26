import type { ToolAnnotations } from '@modelcontextprotocol/server';

/**
 * Tool annotations are hints to the host about a tool's behaviour; hosts use
 * them for approval prompts (auto-approving a read-only tool, for example).
 * They don't enforce anything: catalog-api's key scope does.
 * - readOnlyHint: the tool changes nothing.
 * - openWorldHint: false, because it reaches one closed catalogue, not the
 *   open web.
 * destructiveHint and idempotentHint only mean something when readOnlyHint is
 * false (the MCP spec), so the read tools leave them out.
 */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};
