import { handleCueloopPublicApi } from "../../src/agent/public-api";

/** Serves the read-only cueloop product discovery API. */
export const onRequest: PagesFunction<Env> = (context) => handleCueloopPublicApi(context.request);
