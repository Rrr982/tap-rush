import { createHandler } from '../src/api-entry';
import { handleLeaderboard } from '../src/handlers';
import type { HttpRequest, HttpResponse } from '../src/http';

const handler = createHandler(handleLeaderboard);

export default function (req: HttpRequest, res: HttpResponse) {
  return handler(req, res);
}
