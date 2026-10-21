/**
 * Request handlers for the leaderboard API.
 *
 * The handlers are plain functions over structural request/response types, so
 * they can be unit tested without a Vercel runtime.
 */

import { randomUUID } from 'node:crypto';
import {
  MAX_ROUNDS_PER_HOUR,
  MAX_ROUND_SCORE,
  MIN_ROUND_ELAPSED_MS,
  maxSpawnableOrbs,
} from '../shared/rules';
import type {
  HealthResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  ProfileResponse,
  ScoreResponse,
  SessionResponse,
} from '../shared/contract';
import type { Config } from './config';
import { sanitiseDisplayName } from './display-name';
import {
  corsHeaders,
  getHeader,
  readJsonBody,
  readQueryValue,
  sendError,
  sendJson,
  sendPreflight,
  type HttpRequest,
  type HttpResponse,
} from './http';
import type { Store } from './store';
import { TrustError, verifySignedPlayerInfo } from './trust';

export interface Logger {
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

export const consoleLogger: Logger = {
  warn(message, detail) {
    console.warn(`[tap-rush] ${message}`, detail ?? '');
  },
  error(message, detail) {
    console.error(`[tap-rush] ${message}`, detail ?? '');
  },
};

export interface HandlerDeps {
  config: Config;
  store: Store;
  logger?: Logger;
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Injectable id factory, for tests. */
  newId?: () => string;
}

interface Context {
  deps: HandlerDeps;
  now: number;
  headers: Record<string, string>;
}

function context(req: HttpRequest, deps: HandlerDeps): Context {
  return {
    deps,
    now: (deps.now ?? Date.now)(),
    headers: corsHeaders(getHeader(req, 'origin'), deps.config.allowedOrigins),
  };
}

function loggerFor(deps: HandlerDeps): Logger {
  return deps.logger ?? consoleLogger;
}

function isPreflight(req: HttpRequest): boolean {
  return (req.method ?? 'GET').toUpperCase() === 'OPTIONS';
}

function methodNotAllowed(res: HttpResponse, headers: Record<string, string>): void {
  sendError(res, 405, 'method_not_allowed', 'Method not allowed.', headers);
}

function requireString(
  body: Record<string, unknown>,
  field: string,
  minLength: number,
  maxLength: number,
): string {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new RequestError('bad_request', `\`${field}\` must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new RequestError(
      'bad_request',
      `\`${field}\` must be between ${minLength} and ${maxLength} characters.`,
    );
  }
  return trimmed;
}

function requireInteger(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const value = body[field];
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num)) {
    throw new RequestError('bad_request', `\`${field}\` must be an integer.`);
  }
  if (num < min || num > max) {
    throw new RequestError('bad_request', `\`${field}\` is out of range.`);
  }
  return num;
}

class RequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function parseBody(req: HttpRequest): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = readJsonBody(req);
  } catch (error) {
    throw new RequestError('bad_request', (error as Error).message);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RequestError('bad_request', 'Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

function requireNonce(body: Record<string, unknown>): string {
  const nonce = requireString(body, 'nonce', 16, 128);
  if (!NONCE_RE.test(nonce)) {
    throw new RequestError('bad_request', '`nonce` has an unexpected format.');
  }
  return nonce;
}

/**
 * Verify the client supplied Facebook signature.
 *
 * The player id is taken from the signed payload, never from the request
 * body, so a client cannot claim to be somebody else.
 */
function verifyPlayer(
  deps: HandlerDeps,
  signature: string,
  nonce: string,
  claimedPlayerId?: string | null,
): { playerId: string } {
  if (!deps.config.appSecret) {
    throw new RequestError(
      'unavailable',
      'The server is not configured with FB_APP_SECRET, so scores cannot be verified.',
      503,
    );
  }
  try {
    const verified = verifySignedPlayerInfo(signature, deps.config.appSecret, nonce, {
      maxAgeMs: deps.config.maxSignatureAgeMs,
      claimedPlayerId: claimedPlayerId ?? null,
    });
    return { playerId: verified.playerId };
  } catch (error) {
    if (error instanceof TrustError) {
      loggerFor(deps).warn(`Rejected signed player info: ${error.code}`);
      throw new RequestError('unauthorized', 'The player signature could not be verified.', 401);
    }
    throw error;
  }
}

/** `GET /api/health` */
export async function handleHealth(
  req: HttpRequest,
  res: HttpResponse,
  deps: HandlerDeps,
): Promise<void> {
  if (isPreflight(req)) {
    sendPreflight(res, context(req, deps).headers);
    return;
  }
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    methodNotAllowed(res, context(req, deps).headers);
    return;
  }
  const ctx = context(req, deps);
  let ok = true;
  let error: string | undefined;
  try {
    await deps.store.ping();
  } catch (err) {
    ok = false;
    error = (err as Error).message;
  }
  const body: HealthResponse = {
    ok,
    store: deps.store.driver,
    appId: deps.config.appId,
    time: ctx.now,
    ...(error ? { error } : {}),
  };
  sendJson(res, ok ? 200 : 503, body, ctx.headers);
}

/** `POST /api/session` - open a round and bind it to a verified player. */
export async function handleSession(
  req: HttpRequest,
  res: HttpResponse,
  deps: HandlerDeps,
): Promise<void> {
  const ctx = context(req, deps);
  if (isPreflight(req)) {
    sendPreflight(res, ctx.headers);
    return;
  }
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    methodNotAllowed(res, ctx.headers);
    return;
  }

  try {
    const body = parseBody(req);
    const nonce = requireNonce(body);
    const signature = requireString(body, 'signature', 16, 4096);
    const claimedPlayerId =
      typeof body['playerId'] === 'string' ? (body['playerId'] as string) : null;

    const { playerId } = verifyPlayer(deps, signature, nonce, claimedPlayerId);

    const roundsLastHour = await deps.store.countRoundsSince(playerId, ctx.now - 3_600_000);
    if (roundsLastHour >= MAX_ROUNDS_PER_HOUR) {
      throw new RequestError(
        'rate_limited',
        'Too many rounds played. Try again in a little while.',
        429,
      );
    }

    const player = await deps.store.ensurePlayer(playerId);
    const sessionId = (deps.newId ?? randomUUID)();
    await deps.store.createRound({
      id: sessionId,
      playerId,
      nonce,
      startedAt: ctx.now,
      settledAt: null,
      score: null,
    });

    const response: SessionResponse = {
      ok: true,
      sessionId,
      playerId,
      displayName: player.displayName,
      bestScore: player.bestScore,
    };
    sendJson(res, 201, response, ctx.headers);
  } catch (error) {
    respondWithError(res, error, ctx.headers, deps);
  }
}

/** `POST /api/score` - settle a round. */
export async function handleScore(
  req: HttpRequest,
  res: HttpResponse,
  deps: HandlerDeps,
): Promise<void> {
  const ctx = context(req, deps);
  if (isPreflight(req)) {
    sendPreflight(res, ctx.headers);
    return;
  }
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    methodNotAllowed(res, ctx.headers);
    return;
  }

  try {
    const body = parseBody(req);
    const sessionId = requireString(body, 'sessionId', 8, 64);
    const nonce = requireNonce(body);
    const signature = requireString(body, 'signature', 16, 4096);
    const score = requireInteger(body, 'score', 0, MAX_ROUND_SCORE);
    const claimedPlayerId =
      typeof body['playerId'] === 'string' ? (body['playerId'] as string) : null;

    const { playerId } = verifyPlayer(deps, signature, nonce, claimedPlayerId);

    const round = await deps.store.getRound(sessionId);
    if (!round) {
      throw new RequestError('not_found', 'Unknown round.', 404);
    }
    if (round.playerId !== playerId) {
      throw new RequestError('forbidden', 'This round belongs to a different player.', 403);
    }
    if (round.nonce !== nonce) {
      throw new RequestError('bad_request', 'The round nonce does not match.');
    }
    if (round.settledAt !== null) {
      throw new RequestError('bad_request', 'This round has already been scored.', 409);
    }

    const elapsed = ctx.now - round.startedAt;
    if (elapsed < MIN_ROUND_ELAPSED_MS) {
      throw new RequestError('bad_request', 'That round finished too quickly to be scored.');
    }

    // An orb can only be tapped after it exists, so a score above the number
    // of orbs that could have spawned is not physically possible.
    const maxPossible = maxSpawnableOrbs(elapsed);
    if (score > maxPossible) {
      loggerFor(deps).warn(
        `Rejected impossible score ${score} (max ${maxPossible} in ${elapsed}ms).`,
      );
      throw new RequestError('bad_request', 'That score is not possible in a round.');
    }

    // Settle first: this is the atomic one-shot guard that stops a round
    // from being scored twice.
    const settled = await deps.store.settleRound(round.id, score, ctx.now);
    if (!settled) {
      throw new RequestError('bad_request', 'This round has already been scored.', 409);
    }

    const result = await deps.store.recordScore(playerId, score, ctx.now);
    const rank = await deps.store.rankOf(playerId);
    const displayName = await playerNameFor(deps, playerId);
    const leaders = await deps.store.topPlayers(10);
    const entries: LeaderboardEntry[] = leaders.map((player, index) => ({
      rank: index + 1,
      playerId: player.playerId,
      displayName: player.displayName,
      score: player.bestScore,
    }));

    const response: ScoreResponse = {
      ok: true,
      accepted: true,
      score,
      bestScore: result.bestScore,
      isNewBest: result.isNewBest,
      rank,
      leaderboard: entries,
      player: { rank, score: result.bestScore, displayName },
    };
    sendJson(res, 200, response, ctx.headers);
  } catch (error) {
    respondWithError(res, error, ctx.headers, deps);
  }
}

async function playerNameFor(deps: HandlerDeps, playerId: string): Promise<string> {
  const player = await deps.store.getPlayer(playerId);
  return player?.displayName ?? '';
}

/** `GET /api/leaderboard` - the public top ten. */
export async function handleLeaderboard(
  req: HttpRequest,
  res: HttpResponse,
  deps: HandlerDeps,
): Promise<void> {
  const ctx = context(req, deps);
  if (isPreflight(req)) {
    sendPreflight(res, ctx.headers);
    return;
  }
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    methodNotAllowed(res, ctx.headers);
    return;
  }

  try {
    const requested = Number(readQueryValue(req, 'limit') ?? '10');
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 50)
      : 10;

    const leaders = await deps.store.topPlayers(limit);
    const entries: LeaderboardEntry[] = leaders.map((player, index) => ({
      rank: index + 1,
      playerId: player.playerId,
      displayName: player.displayName,
      score: player.bestScore,
    }));

    let me: LeaderboardResponse['me'] = null;
    const playerId = readQueryValue(req, 'playerId');
    if (playerId) {
      const player = await deps.store.getPlayer(playerId);
      if (player && player.bestScore > 0) {
        me = {
          rank: await deps.store.rankOf(playerId),
          score: player.bestScore,
          displayName: player.displayName,
        };
      }
    }

    const response: LeaderboardResponse = { ok: true, entries, me };
    sendJson(res, 200, response, ctx.headers);
  } catch (error) {
    respondWithError(res, error, ctx.headers, deps);
  }
}

/** `POST /api/profile` - let a player pick their display name. */
export async function handleProfile(
  req: HttpRequest,
  res: HttpResponse,
  deps: HandlerDeps,
): Promise<void> {
  const ctx = context(req, deps);
  if (isPreflight(req)) {
    sendPreflight(res, ctx.headers);
    return;
  }
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    methodNotAllowed(res, ctx.headers);
    return;
  }

  try {
    const body = parseBody(req);
    const nonce = requireNonce(body);
    const signature = requireString(body, 'signature', 16, 4096);
    const claimedPlayerId =
      typeof body['playerId'] === 'string' ? (body['playerId'] as string) : null;

    const { playerId } = verifyPlayer(deps, signature, nonce, claimedPlayerId);

    const displayName = sanitiseDisplayName(body['displayName']);
    if (!displayName) {
      throw new RequestError('bad_request', 'That display name is not usable.');
    }

    await deps.store.ensurePlayer(playerId);
    const player = await deps.store.setDisplayName(playerId, displayName);

    const response: ProfileResponse = { ok: true, displayName: player.displayName };
    sendJson(res, 200, response, ctx.headers);
  } catch (error) {
    respondWithError(res, error, ctx.headers, deps);
  }
}

function respondWithError(
  res: HttpResponse,
  error: unknown,
  headers: Record<string, string>,
  deps: HandlerDeps,
): void {
  if (error instanceof RequestError) {
    sendError(res, error.status, error.code, error.message, headers);
    return;
  }
  loggerFor(deps).error('Unhandled error while serving a request.', error);
  sendError(res, 500, 'internal', 'Something went wrong.', headers);
}
