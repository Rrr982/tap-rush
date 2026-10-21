/**
 * Verification of Facebook-signed player payloads.
 *
 * `FBInstant.player.getSignedPlayerInfoAsync(requestPayload)` returns a
 * `SignedPlayerInfo` whose `getSignature()` is an OAuth2 style signed
 * request:
 *
 *     base64url( hmac_sha256( payload, app_secret ) )  +  "."  +  payload
 *
 * where `payload` is the base64url encoded JSON that contains the
 * `request_payload` we passed in, an `issued_at` timestamp and the player's
 * id. The server recomputes the HMAC with the app secret and compares it in
 * constant time. Because the app secret never leaves the server, a client
 * cannot mint a signature for itself.
 *
 * Meta's reference describes the HMAC input only as "the whole response
 * payload string", which is ambiguous between the base64url segment and the
 * decoded JSON. Both are accepted here; the ambiguity is covered by unit
 * tests and documented in docs/architecture.md.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type TrustErrorCode =
  | 'malformed_signature'
  | 'malformed_payload'
  | 'bad_signature'
  | 'unsupported_algorithm'
  | 'player_not_in_payload'
  | 'request_payload_mismatch'
  | 'signature_expired';

export class TrustError extends Error {
  readonly code: TrustErrorCode;

  constructor(code: TrustErrorCode, message: string) {
    super(message);
    this.name = 'TrustError';
    this.code = code;
  }
}

export interface VerifiedPlayer {
  /** The Facebook player id, taken from the signed payload. */
  playerId: string;
  /** Seconds since epoch, from the payload's `issued_at`. */
  issuedAt: number | null;
  /** The `request_payload` the client asked Facebook to sign. */
  requestPayload: string;
}

export interface VerifyOptions {
  /** Current time in ms. Defaults to `Date.now()`. */
  now?: number;
  /** Maximum age of the payload in ms. Defaults to 10 minutes. */
  maxAgeMs?: number;
  /** Allowed clock skew in ms. Defaults to 1 minute. */
  clockSkewMs?: number;
  /**
   * Optional player id claimed by the client. Used only as a fallback: the
   * id is still authenticated because it must appear inside the signed
   * payload.
   */
  claimedPlayerId?: string | null;
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** Player id keys used by Facebook payloads, in order of preference. */
const PLAYER_ID_KEYS = [
  'player_id',
  'playerId',
  'playerID',
  'player',
  'user_id',
  'userId',
  'sub',
  'id',
];

/** `request_payload` keys used by Facebook payloads. */
const REQUEST_PAYLOAD_KEYS = ['request_payload', 'requestPayload', 'payload'];

const ISSUED_AT_KEYS = ['issued_at', 'issuedAt', 'iat'];

function decodeBase64Url(segment: string): Buffer | null {
  const cleaned = segment.replace(/=+$/, '');
  if (!cleaned || !BASE64URL_RE.test(cleaned)) return null;
  const buf = Buffer.from(cleaned, 'base64url');
  return buf.length > 0 ? buf : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function firstNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.length > 0 && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

/** Collect every string value reachable in a JSON value. */
function collectStringValues(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, into);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) collectStringValues(item, into);
  }
  return into;
}

function sign(appSecret: string, input: string): Buffer {
  return createHmac('sha256', appSecret).update(input, 'utf8').digest();
}

function safeEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

interface ParsedSignature {
  payload: Record<string, unknown>;
  /** The exact string the HMAC may have been computed over. */
  payloadJson: string;
  /** The segment as it appeared in the signature, also a possible HMAC input. */
  payloadSegment: string;
  signatureBytes: Buffer;
}

function parseCandidate(
  signatureSegment: string,
  payloadSegment: string,
  appSecret: string,
): ParsedSignature | null {
  const signatureBytes = decodeBase64Url(signatureSegment);
  if (!signatureBytes) return null;

  const candidates: string[] = [];
  const decoded = decodeBase64Url(payloadSegment);
  if (decoded) candidates.push(decoded.toString('utf8'));
  candidates.push(payloadSegment);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    const matches =
      safeEquals(signatureBytes, sign(appSecret, payloadSegment)) ||
      safeEquals(signatureBytes, sign(appSecret, candidate));
    if (!matches) continue;

    return {
      payload: parsed,
      payloadJson: candidate,
      payloadSegment,
      signatureBytes,
    };
  }
  return null;
}

/**
 * Verify a signed player payload.
 *
 * Throws a {@link TrustError} when the signature cannot be trusted. The error
 * code is safe to return to the client.
 */
export function verifySignedPlayerInfo(
  signature: string,
  appSecret: string,
  expectedRequestPayload: string,
  options: VerifyOptions = {},
): VerifiedPlayer {
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new TrustError('malformed_signature', 'Missing signature.');
  }
  if (!appSecret) {
    throw new TrustError('bad_signature', 'Server is missing the app secret.');
  }

  const parts = signature.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new TrustError('malformed_signature', 'Signature must have two dot separated parts.');
  }

  // Meta documents the signature part first, but the classic Facebook
  // `signed_request` format puts the payload first. Try both.
  const parsed =
    parseCandidate(parts[0], parts[1], appSecret) ?? parseCandidate(parts[1], parts[0], appSecret);

  if (!parsed) {
    throw new TrustError('bad_signature', 'Signature does not match the app secret.');
  }

  const { payload } = parsed;

  const algorithm = payload['algorithm'];
  if (typeof algorithm === 'string' && !/^hmac/i.test(algorithm)) {
    throw new TrustError('unsupported_algorithm', `Unsupported algorithm: ${algorithm}.`);
  }

  const requestPayload = firstString(payload, REQUEST_PAYLOAD_KEYS);
  if (!requestPayload) {
    throw new TrustError(
      'malformed_payload',
      'Signed payload does not contain the request payload.',
    );
  }
  if (requestPayload !== expectedRequestPayload) {
    throw new TrustError(
      'request_payload_mismatch',
      'Signed payload was issued for a different request payload.',
    );
  }

  const issuedAtRaw = firstNumber(payload, ISSUED_AT_KEYS);
  const issuedAt = issuedAtRaw === null ? null : Math.round(issuedAtRaw);

  if (issuedAt !== null) {
    const now = options.now ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? 10 * 60 * 1000;
    const clockSkewMs = options.clockSkewMs ?? 60 * 1000;
    const issuedAtMs = issuedAt * 1000;
    if (issuedAtMs > now + clockSkewMs) {
      throw new TrustError('signature_expired', 'Signed payload is dated in the future.');
    }
    if (now - issuedAtMs > maxAgeMs) {
      throw new TrustError('signature_expired', 'Signed payload has expired.');
    }
  }

  let playerId = firstString(payload, PLAYER_ID_KEYS);

  if (!playerId && options.claimedPlayerId) {
    // Fallback: the claimed id still has to appear inside the signed
    // payload for it to be authentic.
    const values = collectStringValues(payload);
    if (values.has(options.claimedPlayerId)) {
      playerId = options.claimedPlayerId;
    }
  }

  if (!playerId) {
    throw new TrustError('player_not_in_payload', 'Signed payload does not contain a player id.');
  }

  return { playerId, issuedAt, requestPayload };
}

/**
 * Derive a stable, non-identifying display name from a player id.
 *
 * Zero Permissions means Facebook does not share names or photos, so the
 * leaderboard needs its own label. This is deliberately anonymous and
 * deterministic: the same player always gets the same default name.
 */
export function defaultDisplayName(playerId: string): string {
  const digest = createHash('sha256').update(playerId).digest('hex');
  return `RUSH ${digest.slice(0, 4).toUpperCase()}`;
}
