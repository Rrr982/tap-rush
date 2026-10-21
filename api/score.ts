import { createHandler } from '../src/api-entry';
import { handleScore } from '../src/handlers';
import type { HttpRequest, HttpResponse } from '../src/http';

const handler = createHandler(handleScore);

export default function (req: HttpRequest, res: HttpResponse) {
  return handler(req, res);
}
