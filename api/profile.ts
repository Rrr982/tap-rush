import { createHandler } from '../src/api-entry';
import { handleProfile } from '../src/handlers';
import type { HttpRequest, HttpResponse } from '../src/http';

const handler = createHandler(handleProfile);

export default function (req: HttpRequest, res: HttpResponse) {
  return handler(req, res);
}
