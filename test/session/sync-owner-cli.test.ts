import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import * as v from "valibot";
import { submitSyncOperation } from "@cueloop/sync/operations";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";
import {
  sharedExecutionOperations,
  sharedWorkspaceMutators,
} from "../../examples/sync-workspace/shared-workspace.ts";
import { lookupSharedOperationReceipt } from "../../examples/sync-workspace/operation-receipt-client.ts";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "standalone Node owner recovers lost authority replies and expired leases without another provider dispatch",
  async () => {
    const stack = await createTestSyncStack();
    const client = createSharedRecordClient(stack);
    const database = postgres(stack.environment.SYNC_DATABASE_URL);
    let proxy: ReturnType<typeof Bun.serve> | undefined;
    let lostClaimReply = false;
    let expiredReportLease = false;
    let lostReportReply = false;
    let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;

    try {
      const [record] = await client.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync owner CLI test requires its application record");

      const operation = sharedExecutionOperations.request.create({
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, text: "Explain the plan" },
      });
      const outcome = await submitSyncOperation({
        operation,
        submit: (request) => client.mutate(sharedWorkspaceMutators.execution.request(request)),
        lookup: (request) => lookupSharedOperationReceipt({ ...stack, operation: request }),
      });

      expect(outcome.status).toBe("accepted");
      await stack.restartAuthority();
      const executorModule = join(stack.directory, "executor.mjs");
      const dispatchState = join(stack.directory, "provider.json");
      const cleanup = join(stack.directory, "owner-closed");

      writeFileSync(
        executorModule,
        `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
export const syncExecutor = {
  identifier: ${JSON.stringify(randomUUID())},
  async recover(claim) {
    if (!existsSync(${JSON.stringify(dispatchState)})) return {status:'absent'};
    const state = JSON.parse(readFileSync(${JSON.stringify(dispatchState)}, 'utf8'));
    if (state.operationIdentifier !== claim.operationIdentifier) throw new Error('Unknown provider operation');
    return {status:'completed', reference:state.operationIdentifier};
  },
  async dispatch(claim) {
    writeFileSync(${JSON.stringify(dispatchState)}, JSON.stringify({operationIdentifier:claim.operationIdentifier, dispatches:1}), {flag:'wx'});
    throw new Error('Acknowledgement lost after provider acceptance');
  },
  close() { writeFileSync(${JSON.stringify(cleanup)}, 'closed'); },
};
`,
      );
      proxy = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const input = v.parse(
            v.object({ action: v.picklist(["claim", "report"]) }),
            await request.clone().json(),
          );

          if (input.action === "report" && !expiredReportLease) {
            expiredReportLease = true;
            await database`UPDATE sync_execution SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = ${operation.operationIdentifier}`;
          }

          const response = await fetch(
            new Request(new URL("execution", stack.authorityURL), request),
          );

          if (input.action === "claim" && !lostClaimReply && response.ok) {
            lostClaimReply = true;
            await database`UPDATE sync_execution SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = ${operation.operationIdentifier}`;

            return new Response("Temporary authority outage after claim commit", { status: 503 });
          }

          if (input.action === "report" && response.ok && !lostReportReply) {
            lostReportReply = true;

            return new Response("Report reply lost after commit", { status: 503 });
          }

          return response;
        },
      });
      child = Bun.spawn(
        [
          "node",
          "packages/sync/bin/cueloop-sync.js",
          "owner",
          "--application",
          "examples/sync-workspace/authority.ts",
          "--workspace",
          record.workspaceIdentifier.toUpperCase(),
          "--executor",
          executorModule,
        ],
        {
          env: { ...stack.environment, SYNC_AUTHORITY_URL: proxy.url.href },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.timeout(30000),
        },
      );
      const errors = new Response(child.stderr).text();
      let output = "";

      for await (const chunk of child.stdout) {
        output += new TextDecoder().decode(chunk);

        if (output.includes("\n")) break;
      }

      const result = v.parse(
        v.object({ operationIdentifier: v.string(), status: v.string() }),
        JSON.parse(output.trim()),
      );

      expect(result).toMatchObject({
        operationIdentifier: operation.operationIdentifier,
        status: "completed",
      });
      child.kill("SIGTERM");
      expect(await child.exited, await errors).toBe(143);
      expect(JSON.parse(readFileSync(dispatchState, "utf8"))).toEqual({
        operationIdentifier: operation.operationIdentifier,
        dispatches: 1,
      });
      expect(readFileSync(cleanup, "utf8")).toBe("closed");
      expect([lostClaimReply, expiredReportLease, lostReportReply]).toEqual([true, true, true]);
      const inspector = Bun.spawn(
        [
          "node",
          "packages/sync/bin/cueloop-sync.js",
          "connect",
          "--application",
          "examples/sync-workspace/authority.ts",
          "--workspace",
          record.workspaceIdentifier.toUpperCase(),
          "--executions",
        ],
        {
          env: stack.environment,
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.timeout(30000),
        },
      );
      const [inspection, inspectionError, status] = await Promise.all([
        new Response(inspector.stdout).text(),
        new Response(inspector.stderr).text(),
        inspector.exited,
      ]);

      expect(status, inspectionError).toBe(0);
      expect(JSON.parse(inspection)).toMatchObject([
        { id: operation.operationIdentifier, status: "completed" },
      ]);
    } finally {
      child?.kill("SIGTERM");
      await child?.exited;
      proxy?.stop(true);
      await client.close();
      await database.end();
      await stack.close();
    }
  },
  120000,
);
