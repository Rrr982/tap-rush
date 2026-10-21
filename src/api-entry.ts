import type { HandlerDeps } from './handlers';
import { loadConfig } from './config';
import { getStore } from './store-factory';
import type { HttpRequest, HttpResponse } from './http';

type Route = (req: HttpRequest, res: HttpResponse, deps: HandlerDeps) => Promise<void>;

/**
 * Wrap a route handler with the shared setup and a safe failure mode.
 *
 * Vercel turns an unhandled rejection into an opaque 500, so failures are
 * converted into a JSON body that the game can show a sensible message for.
 */
export function createHandler(route: Route) {
  return async function handler(req: HttpRequest, res: HttpResponse): Promise<void> {
    try {
      const config = loadConfig();
      const store = await getStore();
      await route(req, res, { config, store });
    } catch (error) {
      console.error('[tap-rush] Failed to serve request.', error);
      try {
        res.status(503).json({
          ok: false,
          error: 'unavailable',
          message: 'The leaderboard is temporarily unavailable.',
        });
      } catch {
        // The response was already partially written; nothing more to do.
      }
    }
  };
}
