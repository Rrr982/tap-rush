import { createHmac } from 'node:crypto';
import type { Config } from '../src/config';
import type { HttpRequest, HttpResponse } from '../src/http';

export const TEST_SECRET = 'test-app-secret';
export const TEST_NONCE = 'abcdef0123456789abcdef0123456789';

export function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export interface SignOptions {
  requestPayload?: string;
  playerId?: string | null;
  issuedAt?: number;
  algorithm?: string;
  signDecodedJson?: boolean;
  payloadFirst?: boolean;
  secret?: string;
}

/** Build a Facebook style signed request. */
export function sign(options: SignOptions = {}): string {
  const payload: Record<string, unknown> = {
    algorithm: options.algorithm ?? 'HMAC-SHA256',
    request_payload: options.requestPayload ?? TEST_NONCE,
    issued_at: options.issuedAt ?? Math.floor(Date.now() / 1000),
  };
  const playerId = options.playerId === undefined ? 'fb-player-1' : options.playerId;
  if (playerId !== null) payload['player_id'] = playerId;

  const json = JSON.stringify(payload);
  const segment = base64url(json);
  const hmacInput = options.signDecodedJson ? json : segment;
  const signature = base64url(
    createHmac('sha256', options.secret ?? TEST_SECRET)
      .update(hmacInput)
      .digest(),
  );

  return options.payloadFirst ? `${segment}.${signature}` : `${signature}.${segment}`;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    appSecret: TEST_SECRET,
    appId: '1234567890',
    allowedOrigins: ['https://apps.facebook.com'],
    maxSignatureAgeMs: 10 * 60 * 1000,
    storeDriver: 'memory',
    isProduction: false,
    ...overrides,
  };
}

export interface FakeResponse extends HttpResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

export function makeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
    json(body: unknown) {
      res.body = body;
    },
    end() {
      /* nothing to do */
    },
  };
  return res;
}

export function makeRequest(body?: unknown, extra: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://apps.facebook.com' },
    ...(body === undefined ? {} : { body }),
    ...extra,
  };
}
