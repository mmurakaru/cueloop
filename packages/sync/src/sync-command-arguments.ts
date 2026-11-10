export function readSyncCommandFlag(arguments_: string[], name: string, fallback?: string): string {
  const index = arguments_.indexOf(name);
  const value = index < 0 ? fallback : arguments_[index + 1];

  if (!value || value.startsWith("--")) throw new Error(`Sync database command requires ${name}`);

  return value;
}

export function readSyncDatabaseCredential(
  arguments_: string[],
  name: string,
  fallback?: string,
): string {
  const reference = readSyncCommandFlag(arguments_, name, fallback);

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference))
    throw new Error("Sync database credential must name an environment variable");

  const value = process.env[reference];

  if (!value) throw new Error("Sync database credential environment variable is empty");

  return value;
}
