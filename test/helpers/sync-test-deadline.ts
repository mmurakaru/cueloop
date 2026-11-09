export async function waitForTestSyncState<Result>(
  pending: Promise<Result>,
  label: string,
): Promise<Result> {
  const expired = Promise.withResolvers<Result>();
  const timer = setTimeout(
    () => expired.reject(new Error(`Sync test timed out waiting for ${label}`)),
    30000,
  );

  try {
    return await Promise.race([pending, expired.promise]);
  } finally {
    clearTimeout(timer);
  }
}
