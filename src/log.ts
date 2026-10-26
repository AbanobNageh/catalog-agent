export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  /** Where each line goes. Default: stderr. Never stdout: on the stdio transport that's the MCP protocol. */
  write?: (line: string) => void;
  /** The lowest level written. Default: info. */
  level?: LogLevel;
}

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * Field names that hold credentials. A second line of defence: callers never
 * pass the key. Whole names only, so `prompt_tokens` or `keyCount` stay visible.
 */
const SECRET_FIELD =
  /^(authorization|api[-_]?key|(access[-_]?|refresh[-_]?|id[-_]?)?token|(client[-_]?)?secret|password)$/i;

/** One JSON line per event: `{ time, level, msg, ...fields }`. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const write =
    options.write ?? ((line: string) => void process.stderr.write(line));
  const min = LEVELS.indexOf(options.level ?? 'info');

  const log =
    (level: LogLevel) =>
    (msg: string, fields: LogFields = {}): void => {
      if (LEVELS.indexOf(level) < min) return;
      const entry = {
        ...(redact(fields) as LogFields),
        time: new Date().toISOString(),
        level,
        msg,
      };
      write(`${JSON.stringify(entry)}\n`);
    };

  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      SECRET_FIELD.test(k) ? '[redacted]' : redact(v),
    ]),
  );
}
