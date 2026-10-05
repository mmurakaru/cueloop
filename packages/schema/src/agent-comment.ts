import { makeAnchor } from "./anchor";
import { parseBlocks } from "./markdown";
import type { AgentComment, ThreadAgentState } from "./thread-agent";

/** Submitted bottom prompts are discussion roots without duplicating them in stored comments. */
export function agentCommentRoot(state: ThreadAgentState, id: string): AgentComment | undefined {
  const comment = state.comments.find((entry) => entry.id === id);
  if (comment) return comment;
  const submission = state.submissions?.find((entry) => entry.id === id && entry.commentId === id);
  if (!submission) return undefined;
  const blocks = parseBlocks(submission.prompt);
  const anchor = makeAnchor(blocks, 0, 0, Math.min(blocks[0]?.text.length ?? 0, 32768));

  return { id, messageId: id, anchor, body: submission.prompt.slice(0, 32768), sent: true };
}
