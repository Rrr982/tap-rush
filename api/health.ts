import { createHandler } from '../src/api-entry';
import { handleHealth } from '../src/handlers';
import type { HttpRequest, HttpResponse } from '../src/http';

const handler = createHandler(handleHealth);

export default function (req: HttpRequest, res: HttpResponse) {
  return handler(req, res);
}
