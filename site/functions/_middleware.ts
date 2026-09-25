import { serveNegotiatedDocument } from "../src/agent/markdown-response";

/** Negotiates HTML and Markdown for public cueloop pages. */
export const onRequest: PagesFunction<Env> = (context) => {
  return serveNegotiatedDocument(
    context.request,
    (request) => context.env.ASSETS.fetch(request),
    (request) => context.next(request),
  );
};
