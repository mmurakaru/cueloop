import type { Schema } from "@rocicorp/zero";
import { executePostgresQuery, ZQLDatabase, type DBTransaction } from "@rocicorp/zero/server";
import type postgres from "postgres";

/** The caller owns the Postgres client and closes its pool after the authority stops. */
export function createSyncPostgresDatabase<DatabaseSchema extends Schema>(
  schema: DatabaseSchema,
  connection: postgres.Sql,
) {
  const query = (statement: string, parameters: unknown[]) =>
    connection.unsafe(statement, syncPostgresParameters(parameters));

  return new ZQLDatabase<DatabaseSchema, postgres.TransactionSql>(
    {
      query,
      transaction: (run) =>
        connection.begin(async (connectionTransaction) => {
          const transaction: DBTransaction<postgres.TransactionSql> = {
            wrappedTransaction: connectionTransaction,
            query: (statement, parameters) =>
              connectionTransaction.unsafe(statement, syncPostgresParameters(parameters)),
            runQuery: (...parameters) => executePostgresQuery(transaction, ...parameters),
          };

          return run(transaction);
        }),
    },
    schema,
  );
}

function syncPostgresParameters(parameters: unknown[]): postgres.ParameterOrJSON<never>[] {
  // SAFETY: Zero supplies bound PostgreSQL values; the driver rejects unsupported values.
  return parameters as postgres.ParameterOrJSON<never>[];
}
