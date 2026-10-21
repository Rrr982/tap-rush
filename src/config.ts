/**
 * Runtime configuration, read from the environment.
 *
 * Everything is optional except the app secret, which the API refuses to
 * serve scores without. The API degrades loudly rather than silently: if the
 * secret is missing the health endpoint reports it and score submissions are
 * rejected with `unavailable`.
 */

export interface Config {
  /** Facebook app secret. Used to verify signed player payloads. */
  appSecret: string;
  /** Facebook app id, for logging and the health endpoint. */
  appId: string | null;
  /**
   * Origins allowed to call the API. The Instant Game runs in a Facebook
   * iframe, so cross-origin calls are expected and need an explicit
   * allowlist.
   */
  allowedOrigins: string[];
  /** How long a signed payload stays acceptable, in ms. */
  maxSignatureAgeMs: number;
  /** Which store implementation to use: `postgres` or `memory`. */
  storeDriver: 'postgres' | 'memory';
  /** True in production. */
  isProduction: boolean;
}

/**
 * Origins that are always allowed. The Instant Game is served from a
 * Facebook iframe; the exact host varies between the web player, the mobile
 * app and Messenger, so the common set is listed here and can be extended
 * with `CORS_ORIGINS`.
 */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://apps.facebook.com',
  'https://www.facebook.com',
  'https://web.facebook.com',
  'https://m.facebook.com',
  'https://messenger.com',
];

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const configured = splitList(env['CORS_ORIGINS']);
  const allowedOrigins = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured])];

  const explicitDriver = env['DB_DRIVER'];
  const storeDriver: 'postgres' | 'memory' =
    explicitDriver === 'memory' || explicitDriver === 'postgres'
      ? explicitDriver
      : env['DATABASE_URL']
        ? 'postgres'
        : 'memory';

  const maxAgeRaw = Number(env['MAX_SIGNATURE_AGE_MS']);

  return {
    appSecret: env['FB_APP_SECRET'] ?? '',
    appId: env['FB_APP_ID'] ?? null,
    allowedOrigins,
    maxSignatureAgeMs: Number.isFinite(maxAgeRaw) && maxAgeRaw > 0 ? maxAgeRaw : 10 * 60 * 1000,
    storeDriver,
    isProduction: env['VERCEL_ENV'] === 'production' || env['NODE_ENV'] === 'production',
  };
}
