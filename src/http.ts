/**
 * Small HTTP helpers shared by the API functions.
 *
 * The types are structural on purpose: the handlers work with Vercel's
 * request/response objects without importing `@vercel/node` into the domain
 * layer, which keeps them unit testable.
 */

export interface HttpRequest {
  method?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  end(): void;
}

export function getHeader(req: HttpRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()] ?? req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

/**
 * Build the CORS headers for a request.
 *
 * The origin is echoed back only when it is on the allowlist. An unknown
 * origin simply gets no `Access-Control-Allow-Origin` header, so the browser
 * blocks the response - which is the behaviour we want.
 */
export function corsHeaders(
  origin: string | undefined,
  allowedOrigins: string[],
): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  };
  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function applyHeaders(res: HttpResponse, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
}

export function sendJson(
  res: HttpResponse,
  status: number,
  body: unknown,
  headers: Record<string, string>,
): void {
  applyHeaders(res, headers);
  res.status(status).json(body);
}

export function sendError(
  res: HttpResponse,
  status: number,
  error: string,
  message: string,
  headers: Record<string, string>,
): void {
  sendJson(res, status, { ok: false, error, message }, headers);
}

export function sendPreflight(res: HttpResponse, headers: Record<string, string>): void {
  applyHeaders(res, headers);
  res.status(204).end();
}

/** Read and parse a JSON request body, with a size guard. */
export function readJsonBody(req: HttpRequest): unknown {
  const body = req.body;
  if (body === undefined || body === null) {
    throw new Error('Empty request body.');
  }
  if (typeof body === 'string') {
    if (body.length > 16_384) {
      throw new Error('Request body is too large.');
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new Error('Request body is not valid JSON.');
    }
  }
  if (typeof body === 'object') {
    return body;
  }
  throw new Error('Request body must be a JSON object.');
}

export function readQueryValue(req: HttpRequest, name: string): string | undefined {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}
