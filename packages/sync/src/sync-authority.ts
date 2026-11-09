import type { Schema } from "@rocicorp/zero";
import {
  handleMutateRequest,
  handleQueryRequest,
  type Database,
  type ExtractTransactionType,
  type MutateRequestHandler,
  type QueryRequestHandler,
} from "@rocicorp/zero/server";

export interface SyncPrincipal<Context> {
  userIdentifier: string;
  context: Context;
}

export interface SyncAuthorityOptions<
  ApplicationSchema extends Schema,
  ApplicationDatabase extends Database<ExtractTransactionType<ApplicationDatabase>>,
  Context,
> {
  schema: ApplicationSchema;
  database: ApplicationDatabase;
  authenticate: (request: Request) => Promise<SyncPrincipal<Context> | null>;
  query: (principal: SyncPrincipal<Context>) => QueryRequestHandler;
  mutate: (principal: SyncPrincipal<Context>) => MutateRequestHandler<ApplicationDatabase>;
}

export function createSyncAuthority<
  ApplicationSchema extends Schema,
  ApplicationDatabase extends Database<ExtractTransactionType<ApplicationDatabase>>,
  Context,
>(options: SyncAuthorityOptions<ApplicationSchema, ApplicationDatabase, Context>) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;

    if (path !== "/query" && path !== "/mutate") return new Response("Not found", { status: 404 });

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }

    const principal = await options.authenticate(request);

    if (!principal) return new Response("Unauthorized", { status: 401 });

    if (path === "/query") {
      return Response.json(
        await handleQueryRequest({
          schema: options.schema,
          request,
          userID: principal.userIdentifier,
          handler: options.query(principal),
        }),
      );
    }

    return Response.json(
      await handleMutateRequest({
        dbProvider: options.database,
        request,
        userID: principal.userIdentifier,
        handler: options.mutate(principal),
      }),
    );
  };
}
