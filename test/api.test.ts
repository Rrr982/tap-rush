import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ROUND_SCORE, MIN_ROUND_ELAPSED_MS } from '../shared/rules';
import {
  handleHealth,
  handleLeaderboard,
  handleProfile,
  handleScore,
  handleSession,
} from '../src/handlers';
import type { HandlerDeps } from '../src/handlers';
import { MemoryStore } from '../src/store-memory';
import { makeRequest, makeResponse, sign, testConfig, TEST_NONCE } from './helpers';

let now = 1_700_000_000_000;

function deps(store: MemoryStore): HandlerDeps {
  return {
    config: testConfig(),
    store,
    logger: { warn: () => undefined, error: () => undefined },
    now: () => now,
    newId: () => `session-${now}`,
  };
}

beforeEach(() => {
  now = 1_700_000_000_000;
});

describe('POST /api/session', () => {
  it('creates a round for a verified player', async () => {
    const store = new MemoryStore();
    const res = makeResponse();
    await handleSession(makeRequest({ nonce: TEST_NONCE, signature: sign() }), res, deps(store));

    expect(res.statusCode).toBe(201);
    const body = res.body as { ok: boolean; sessionId: string; playerId: string };
    expect(body.ok).toBe(true);
    expect(body.playerId).toBe('fb-player-1');
    expect(body.sessionId).toBeTruthy();
  });

  it('rejects a request without a valid signature', async () => {
    const store = new MemoryStore();
    const res = makeResponse();
    await handleSession(
      makeRequest({ nonce: TEST_NONCE, signature: sign({ secret: 'wrong' }) }),
      res,
      deps(store),
    );

    expect(res.statusCode).toBe(401);
    expect((res.body as { ok: boolean }).ok).toBe(false);
  });

  it('rejects a missing body', async () => {
    const store = new MemoryStore();
    const res = makeResponse();
    await handleSession(makeRequest(undefined, { method: 'POST' }), res, deps(store));
    expect(res.statusCode).toBe(400);
  });

  it('sets the CORS headers for an allowed origin', async () => {
    const store = new MemoryStore();
    const res = makeResponse();
    await handleSession(makeRequest({ nonce: TEST_NONCE, signature: sign() }), res, deps(store));
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://apps.facebook.com');
  });

  it('does not echo an unknown origin', async () => {
    const store = new MemoryStore();
    const res = makeResponse();
    await handleSession(
      makeRequest(
        { nonce: TEST_NONCE, signature: sign() },
        {
          headers: { origin: 'https://evil.example' },
        },
      ),
      res,
      deps(store),
    );
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('POST /api/score', () => {
  async function openSession(store: MemoryStore): Promise<string> {
    const res = makeResponse();
    await handleSession(makeRequest({ nonce: TEST_NONCE, signature: sign() }), res, deps(store));
    return (res.body as { sessionId: string }).sessionId;
  }

  it('accepts a plausible score and records a new best', async () => {
    const store = new MemoryStore();
    const sessionId = await openSession(store);
    now += MIN_ROUND_ELAPSED_MS + 500;

    const res = makeResponse();
    await handleScore(
      makeRequest({ sessionId, nonce: TEST_NONCE, signature: sign(), score: 3 }),
      res,
      deps(store),
    );

    expect(res.statusCode).toBe(200);
    const body = res.body as { accepted: boolean; isNewBest: boolean; bestScore: number };
    expect(body.accepted).toBe(true);
    expect(body.isNewBest).toBe(true);
    expect(body.bestScore).toBe(3);
  });

  it('rejects a score that is impossible in the elapsed time', async () => {
    const store = new MemoryStore();
    const sessionId = await openSession(store);
    now += MIN_ROUND_ELAPSED_MS + 500;

    const res = makeResponse();
    await handleScore(
      makeRequest({ sessionId, nonce: TEST_NONCE, signature: sign(), score: 5000 }),
      res,
      deps(store),
    );

    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('bad_request');
  });

  it('rejects a score above the absolute maximum', async () => {
    const store = new MemoryStore();
    const sessionId = await openSession(store);
    now += 60_000;

    const res = makeResponse();
    await handleScore(
      makeRequest({ sessionId, nonce: TEST_NONCE, signature: sign(), score: MAX_ROUND_SCORE + 1 }),
      res,
      deps(store),
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a round that finished too quickly', async () => {
    const store = new MemoryStore();
    const sessionId = await openSession(store);
    now += 100;

    const res = makeResponse();
    await handleScore(
      makeRequest({ sessionId, nonce: TEST_NONCE, signature: sign(), score: 1 }),
      res,
      deps(store),
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a second score for the same round', async () => {
    const store = new MemoryStore();
    const sessionId = await openSession(store);
    now += MIN_ROUND_ELAPSED_MS + 500;

    const first = makeResponse();
    await handleScore(
      makeRequest({ sessionId, nonce: TEST_NONCE, signature: sign(), score: 2 }),
      first,
      deps(store),
    );
    expect(first.statusCode).toBe(200);

    const second = makeResponse();
    await handleScore(
      makeRequest({ sessionId, nonce: TEST_NONCE, signature: sign(), score: 9 }),
      second,
      deps(store),
    );
    expect(second.statusCode).toBe(409);
  });

  it("rejects a score for somebody else's round", async () => {
    const store = new MemoryStore();
    const sessionId = await openSession(store);
    now += MIN_ROUND_ELAPSED_MS + 500;

    const res = makeResponse();
    await handleScore(
      makeRequest({
        sessionId,
        nonce: TEST_NONCE,
        signature: sign({ playerId: 'someone-else' }),
        score: 2,
      }),
      res,
      deps(store),
    );
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unknown round', async () => {
    const store = new MemoryStore();
    const res = makeResponse();
    await handleScore(
      makeRequest({ sessionId: 'unknown-session', nonce: TEST_NONCE, signature: sign(), score: 1 }),
      res,
      deps(store),
    );
    expect(res.statusCode).toBe(404);
  });

  it('keeps the best score when a worse score is submitted', async () => {
    const store = new MemoryStore();
    const sessionId = await openSession(store);
    now += 5_000;

    const first = makeResponse();
    await handleScore(
      makeRequest({ sessionId, nonce: TEST_NONCE, signature: sign(), score: 5 }),
      first,
      deps(store),
    );
    expect(first.statusCode).toBe(200);

    const res = makeResponse();
    await handleScore(
      makeRequest({ sessionId, nonce: TEST_NONCE, signature: sign(), score: 1 }),
      res,
      deps(store),
    );
    // The round is already settled, so the second submission is refused.
    expect(res.statusCode).toBe(409);

    const board = makeResponse();
    await handleLeaderboard(makeRequest(undefined, { method: 'GET' }), board, deps(store));
    const entries = (board.body as { entries: { score: number }[] }).entries;
    expect(entries[0]?.score).toBe(5);
  });
});

describe('GET /api/leaderboard', () => {
  it('returns the entries ordered by score', async () => {
    const store = new MemoryStore();
    await store.ensurePlayer('a');
    await store.recordScore('a', 10, 1);
    await store.ensurePlayer('b');
    await store.recordScore('b', 30, 2);
    await store.ensurePlayer('c');
    await store.recordScore('c', 20, 3);

    const res = makeResponse();
    await handleLeaderboard(makeRequest(undefined, { method: 'GET' }), res, deps(store));

    const body = res.body as { entries: { rank: number; score: number; displayName: string }[] };
    expect(body.entries.map((entry) => entry.score)).toEqual([30, 20, 10]);
    expect(body.entries[0]?.rank).toBe(1);
  });

  it('highlights the requesting player', async () => {
    const store = new MemoryStore();
    await store.ensurePlayer('a');
    await store.recordScore('a', 10, 1);

    const res = makeResponse();
    await handleLeaderboard(
      makeRequest(undefined, { method: 'GET', query: { playerId: 'a' } }),
      res,
      deps(store),
    );

    const body = res.body as { me: { rank: number; score: number } | null };
    expect(body.me?.rank).toBe(1);
    expect(body.me?.score).toBe(10);
  });
});

describe('POST /api/profile', () => {
  it('renames a player', async () => {
    const store = new MemoryStore();
    const res = makeResponse();
    await handleProfile(
      makeRequest({ nonce: TEST_NONCE, signature: sign(), displayName: 'Neon Fox' }),
      res,
      deps(store),
    );

    expect(res.statusCode).toBe(200);
    expect((res.body as { displayName: string }).displayName).toBe('Neon Fox');
  });

  it('rejects an unusable display name', async () => {
    const store = new MemoryStore();
    const res = makeResponse();
    await handleProfile(
      makeRequest({ nonce: TEST_NONCE, signature: sign(), displayName: '  ' }),
      res,
      deps(store),
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/health', () => {
  it('reports the store driver', async () => {
    const store = new MemoryStore();
    const res = makeResponse();
    await handleHealth(makeRequest(undefined, { method: 'GET' }), res, deps(store));

    expect(res.statusCode).toBe(200);
    const body = res.body as { ok: boolean; store: string; appId: string };
    expect(body.ok).toBe(true);
    expect(body.store).toBe('memory');
    expect(body.appId).toBe('1234567890');
  });
});
