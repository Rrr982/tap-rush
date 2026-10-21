import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TrustError, defaultDisplayName, verifySignedPlayerInfo } from '../src/trust';

const SECRET = 'test-app-secret';
const NONCE = 'abcdef0123456789abcdef0123456789';

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

interface SignOptions {
  requestPayload?: string;
  playerId?: string | null;
  issuedAt?: number;
  algorithm?: string;
  /** Sign the raw JSON instead of the base64url segment. */
  signDecodedJson?: boolean;
  /** Put the payload before the signature. */
  payloadFirst?: boolean;
  secret?: string;
}

function sign(options: SignOptions = {}): string {
  const payload: Record<string, unknown> = {
    algorithm: options.algorithm ?? 'HMAC-SHA256',
    request_payload: options.requestPayload ?? NONCE,
    issued_at: options.issuedAt ?? Math.floor(Date.now() / 1000),
  };
  const playerId = options.playerId === undefined ? 'fb-player-1' : options.playerId;
  if (playerId !== null) payload['player_id'] = playerId;

  const json = JSON.stringify(payload);
  const segment = base64url(json);
  const hmacInput = options.signDecodedJson ? json : segment;
  const signature = base64url(
    createHmac('sha256', options.secret ?? SECRET)
      .update(hmacInput)
      .digest(),
  );

  return options.payloadFirst ? `${segment}.${signature}` : `${signature}.${segment}`;
}

describe('verifySignedPlayerInfo', () => {
  it('accepts a signature computed over the base64url payload segment', () => {
    const verified = verifySignedPlayerInfo(sign(), SECRET, NONCE);
    expect(verified.playerId).toBe('fb-player-1');
    expect(verified.requestPayload).toBe(NONCE);
  });

  it('accepts a signature computed over the decoded JSON payload', () => {
    const verified = verifySignedPlayerInfo(sign({ signDecodedJson: true }), SECRET, NONCE);
    expect(verified.playerId).toBe('fb-player-1');
  });

  it('accepts the payload first ordering', () => {
    const verified = verifySignedPlayerInfo(sign({ payloadFirst: true }), SECRET, NONCE);
    expect(verified.playerId).toBe('fb-player-1');
  });

  it('rejects a signature made with a different secret', () => {
    expect(() => verifySignedPlayerInfo(sign({ secret: 'nope' }), SECRET, NONCE)).toThrow(
      TrustError,
    );
  });

  it('rejects a signature issued for a different nonce', () => {
    expect(() => verifySignedPlayerInfo(sign({ requestPayload: 'other' }), SECRET, NONCE)).toThrow(
      /different request payload/,
    );
  });

  it('rejects a payload that is too old', () => {
    const old = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
    expect(() => verifySignedPlayerInfo(sign({ issuedAt: old }), SECRET, NONCE)).toThrow(/expired/);
  });

  it('rejects a payload dated in the future', () => {
    const future = Math.floor((Date.now() + 10 * 60 * 1000) / 1000);
    expect(() => verifySignedPlayerInfo(sign({ issuedAt: future }), SECRET, NONCE)).toThrow(
      /future/,
    );
  });

  it('rejects an unsupported algorithm', () => {
    expect(() => verifySignedPlayerInfo(sign({ algorithm: 'RSA-SHA256' }), SECRET, NONCE)).toThrow(
      /Unsupported algorithm/,
    );
  });

  it('rejects a malformed signature', () => {
    expect(() => verifySignedPlayerInfo('not-a-signature', SECRET, NONCE)).toThrow(TrustError);
  });

  it('takes the player id from the signed payload, not from the client', () => {
    const verified = verifySignedPlayerInfo(sign(), SECRET, NONCE, {
      claimedPlayerId: 'someone-else',
    });
    expect(verified.playerId).toBe('fb-player-1');
  });

  it('falls back to the claimed id only when it appears in the payload', () => {
    const payload = JSON.stringify({
      algorithm: 'HMAC-SHA256',
      request_payload: NONCE,
      issued_at: Math.floor(Date.now() / 1000),
      user: { id: 'nested-player' },
    });
    const segment = base64url(payload);
    const signature = base64url(createHmac('sha256', SECRET).update(segment).digest());

    const verified = verifySignedPlayerInfo(`${signature}.${segment}`, SECRET, NONCE, {
      claimedPlayerId: 'nested-player',
    });
    expect(verified.playerId).toBe('nested-player');
  });

  it('rejects a payload without any player id', () => {
    expect(() => verifySignedPlayerInfo(sign({ playerId: null }), SECRET, NONCE)).toThrow(
      /player id/,
    );
  });
});

describe('defaultDisplayName', () => {
  it('is stable for the same player id', () => {
    expect(defaultDisplayName('abc')).toBe(defaultDisplayName('abc'));
  });

  it('is short and does not leak the player id', () => {
    const name = defaultDisplayName('a-very-long-facebook-player-id');
    expect(name).toMatch(/^RUSH [0-9A-F]{4}$/);
    expect(name).not.toContain('facebook');
  });

  it('differs between players', () => {
    expect(defaultDisplayName('abc')).not.toBe(defaultDisplayName('abd'));
  });
});
