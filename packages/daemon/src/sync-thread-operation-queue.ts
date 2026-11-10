/** Draft writes and route changes share a queue so handoff cannot leave input at the prior endpoint. */
export class SyncThreadOperationQueue {
  private readonly pending = new Map<string, Promise<void>>();

  run<Result>(threadIdentifier: string, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.pending.get(threadIdentifier) ?? Promise.resolve();
    const result = previous.then(operation);
    const completion = result.then(
      () => {},
      () => {},
    );

    this.pending.set(threadIdentifier, completion);
    void completion.then(() => {
      if (this.pending.get(threadIdentifier) === completion) this.pending.delete(threadIdentifier);
    });

    return result;
  }

  async drain(): Promise<void> {
    await Promise.all(this.pending.values());
  }
}
