/*
 * The install-command chip: a monospace `$ command` in a bordered field with a
 * copy affordance, like the terminal-native dev sites it echoes. React Aria
 * Button handles focus/keyboard; the label flips to "copied" briefly on click.
 */
import { Button } from "react-aria-components";
import { useState } from "react";

interface CopyCommandProps {
  command: string;
}

export default function CopyCommand({ command }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable (e.g. insecure context) - the command is still visible
    }
  }

  return (
    <div className="copy-command">
      <span className="copy-command__prompt" aria-hidden="true">
        $
      </span>
      <code className="copy-command__text">{command}</code>
      <Button
        className="copy-command__btn"
        aria-label={copied ? "Copied" : `Copy: ${command}`}
        onPress={copy}
      >
        {copied ? "copied" : "copy"}
      </Button>
    </div>
  );
}
