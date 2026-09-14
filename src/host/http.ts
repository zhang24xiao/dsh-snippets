/**
 * Minimal JSON-over-HTTP helpers for the plugin's own host routes.
 *
 * The route surface exists only for work a browser cannot do (read a local
 * folder, call GitHub with a stored token, open the backups directory), and it
 * is **loopback-only**: on a LAN or tunneled deployment the official settings
 * wire is the only path that carries snippet data, so an unpaired visitor can
 * never reach these endpoints. See `routes.ts` for the full rationale.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Bytes accepted for one request body; the largest payload is a snippet library. */
const MAX_BODY_BYTES = 4 * 1024 * 1024

/** The literal addresses a loopback socket can carry. */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** True when the request arrived over the loopback interface. */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  return address !== undefined && LOOPBACK_ADDRESSES.has(address)
}

/** Write one JSON response. */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** A successful envelope. */
export function ok<T extends object>(payload: T): { ok: true } & T {
  return { ok: true, ...payload }
}

/** A failed envelope; `code` is a stable machine token the UI maps to copy. */
export function fail(code: string, message?: string): { ok: false; code: string; message?: string } {
  return message === undefined ? { ok: false, code } : { ok: false, code, message }
}

/** Read and parse a JSON request body, or throw a coded error. */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new RouteError('body-too-large')
    chunks.push(buf)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new RouteError('body-not-object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof RouteError) throw error
    throw new RouteError('body-not-json')
  }
}

/** A route failure carrying a stable code the browser maps to localized copy. */
export class RouteError extends Error {
  /** Stable machine token; never a human sentence. */
  readonly code: string

  /** @param code - stable machine token. */
  constructor(code: string) {
    super(code)
    this.name = 'RouteError'
    this.code = code
  }
}

/** Read a required string field. */
export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '') throw new RouteError(`missing-${key}`)
  return value
}

/** Read an optional string field. */
export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' ? value : undefined
}

/** Read an optional boolean field. */
export function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key]
  return typeof value === 'boolean' ? value : undefined
}

/** Wrap one handler so a thrown {@link RouteError} becomes a clean JSON reply. */
export function handle(
  fn: (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) => Promise<void> | void,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const body = req.method === 'POST' ? await readJsonBody(req) : {}
      await fn(req, res, body)
    } catch (error) {
      if (error instanceof RouteError) {
        sendJson(res, 400, fail(error.code))
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, 500, fail('internal', message))
    }
  }
}
