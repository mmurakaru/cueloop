import { spawn } from "node:child_process";
import type { Message, MessageOutcome } from "@cueloop/schema";
import type { ForgeReviewPort } from "./harness-thread-controller";
import type { DeliveredMessageStore } from "./delivered-message-store";

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

/** Use the authenticated gh CLI and journal successful post-back by Message ID. */
export function createGitHubForgeReviewPort(delivered: DeliveredMessageStore, command = "gh") {
  async function importPullRequest(
    pullRequestReference: string,
    cwd?: string,
  ): Promise<{ content: string; title: string }> {
    const result = await runForgeCommand(command, ["pr", "diff", pullRequestReference], cwd);

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

  async function postPullRequestMessage(
    pullRequestReference: string,
    message: Message,
    cwd?: string,
  ): Promise<void> {
    const inject = async () => {
      const result = await runForgeCommand(
        command,
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

    await delivered.sendOnce(message, inject);
  }

  return { importPullRequest, postPullRequestMessage } satisfies ForgeReviewPort;
}
