import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

function isStatementDeclaration(node: ESTree.Node): boolean {
  if (node.type === "VariableDeclaration") return true;
  if (node.type === "ExportNamedDeclaration" && node.declaration)
    return node.declaration.type === "VariableDeclaration";

  return false;
}

/** Separate declaration runs and returns without changing statement or comment ownership. */
export const statementPaddingRule = defineRule({
  meta: {
    type: "layout",
    fixable: "whitespace",
    schema: [],
    messages: { padding: "Add a blank line after declarations and before return statements." },
  },
  createOnce(context) {
    const checkStatements = (statements: readonly ESTree.Node[]) => {
      const source = context.sourceCode;

      for (let index = 1; index < statements.length; index++) {
        const previous = statements[index - 1]!;
        const next = statements[index]!;

        if (
          next.type !== "ReturnStatement" &&
          !(isStatementDeclaration(previous) && !isStatementDeclaration(next))
        )
          continue;
        const comments = source.getCommentsBefore(next);
        let boundary = previous.end;
        let boundaryLine = previous.loc.end.line;
        let start = next.start;
        let startLine = next.loc.start.line;

        for (const comment of comments) {
          if (comment.start < boundary) continue;
          if (comment.loc.start.line > boundaryLine) {
            start = comment.start;
            startLine = comment.loc.start.line;
            break;
          }
          boundary = comment.end;
          boundaryLine = comment.loc.end.line;
        }
        if (startLine > boundaryLine + 1) continue;
        const gap = source.text.slice(boundary, start);

        const newline = source.text.includes("\r\n") ? "\r\n" : "\n";
        const padding = gap.includes("\n") ? newline : newline + newline;
        const offset = gap.includes("\n") ? source.text.lastIndexOf("\n", start - 1) + 1 : start;

        context.report({
          node: next,
          messageId: "padding",
          fix: (fixer) => fixer.insertTextBeforeRange([offset, offset], padding),
        });
      }
    };

    return {
      Program: (node) => checkStatements(node.body),
      BlockStatement: (node) => checkStatements(node.body),
      SwitchCase: (node) => checkStatements(node.consequent),
      TSModuleBlock: (node) => checkStatements(node.body),
    };
  },
});

export default eslintCompatPlugin({
  meta: { name: "statement-padding" },
  rules: { "blank-lines": statementPaddingRule },
});
