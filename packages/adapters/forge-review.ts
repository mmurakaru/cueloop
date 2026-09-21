/** GitHub pull request import and Message post-back shared by CLI and harness workflows. */

import { spawn } from "node:child_process";
import type { Message, MessageOutcome } from "@cueloop/schema";
import type { ForgeReviewPort } from "./harness-thread-controller";
import { DeliveredMessageStore } from "./delivered-message-store";

interface ForgeCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const MESSAGE_OUTCOME_FLAG: Record<MessageOutcome, string> = {
  approved: "--approve",
  changes_requested: "--request-changes",
};

async function runForgeCommand(
  command: string,
  args: string[],
  cwd?: string,
): Promise<ForgeCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Uses the user's authenticated gh CLI and journals successful post-back by Message ID. */
export class GitHubForgeReviewPort implements ForgeReviewPort {
  constructor(
    private readonly delivered: DeliveredMessageStore,
    private readonly command = "gh",
  ) {}

  async importPullRequest(
    pullRequestReference: string,
    cwd?: string,
  ): Promise<{ content: string; title: string }> {
    const result = await runForgeCommand(this.command, ["pr", "diff", pullRequestReference], cwd);

    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim() || `gh pr diff ${pullRequestReference} failed (exit ${result.code})`,
      );
    }
    if (!result.stdout.trim()) {
      throw new Error(`PR ${pullRequestReference} has an empty diff - nothing to review`);
    }

    return { content: result.stdout, title: `PR ${pullRequestReference}` };
  }

  async postPullRequestMessage(
    pullRequestReference: string,
    message: Message,
    cwd?: string,
  ): Promise<void> {
    const inject = async () => {
      const result = await runForgeCommand(
        this.command,
        [
          "pr",
          "review",
          pullRequestReference,
          MESSAGE_OUTCOME_FLAG[message.outcome],
          "--body",
          message.body,
        ],
        cwd,
      );

      if (result.code !== 0) {
        throw new Error(
          result.stderr.trim() ||
            `gh pr review ${pullRequestReference} failed (exit ${result.code})`,
        );
      }
    };

    await this.delivered.sendOnce(message, inject);
  }
}
