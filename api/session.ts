import { createHandler } from '../src/api-entry';
import { handleSession } from '../src/handlers';
import type { HttpRequest, HttpResponse } from '../src/http';

const handler = createHandler(handleSession);

export default function (req: HttpRequest, res: HttpResponse) {
  return handler(req, res);
}
