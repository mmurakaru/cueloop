/*
 * The docs page toolbar: a "Copy page" button that copies the raw Markdown of
 * the current page, plus a dropdown with view-source and open-in-LLM options.
 * The markdown is passed in at build time from the layout.
 */
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { useRef, useState } from "react";

interface CopyPageProps {
  markdown: string;
  editUrl: string;
  pageUrl: string;
}

export default function CopyPage({ markdown, editUrl, pageUrl }: CopyPageProps) {
  const [copied, setCopied] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable (insecure context) - nothing to do
    }
  }

  const askUrl = `https://chatgpt.com/?q=${encodeURIComponent(
    `Read ${pageUrl} and answer my questions about it.`,
  )}`;

  return (
    <div className="copypage" ref={groupRef}>
      <Button className="copypage__main" onPress={copyMarkdown}>
        <span className="copypage__ico copypage__ico--copy" aria-hidden="true" />
        {copied ? "Copied" : "Copy page"}
      </Button>
      <MenuTrigger>
        <Button className="copypage__toggle" aria-label="More page options">
          <span className="copypage__ico copypage__ico--chevron" aria-hidden="true" />
        </Button>
        <Popover className="copypage__popover" placement="bottom start" triggerRef={groupRef}>
          <Menu className="copypage__menu">
            <MenuItem className="copypage__item" onAction={copyMarkdown}>
              Copy as Markdown
            </MenuItem>
            <MenuItem
              className="copypage__item"
              href={editUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View source on GitHub
            </MenuItem>
            <MenuItem
              className="copypage__item"
              href={askUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in ChatGPT
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  );
}
