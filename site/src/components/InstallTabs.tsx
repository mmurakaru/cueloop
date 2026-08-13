/*
 * Install-method picker: a React Aria Tabs widget over the ways to get cueloop
 * (npm, bun, pnpm, brew, mise, nix). Each panel shows one command with its own
 * copy affordance. Keyboard + ARIA come from react-aria-components; the visual
 * is a bordered terminal-style field with crop-marks.
 */
import { Tabs, TabList, Tab, TabPanel, Button } from "react-aria-components";
import { useState } from "react";

interface Method {
  id: string;
  label: string;
  command: string;
}

const METHODS: Method[] = [
  { id: "npm", label: "npm", command: "npm i -g cueloop" },
  { id: "bun", label: "bun", command: "bun add -g cueloop" },
  { id: "pnpm", label: "pnpm", command: "pnpm add -g cueloop" },
  { id: "brew", label: "brew", command: "brew install mmurakaru/tap/cueloop" },
  { id: "mise", label: "mise", command: "mise use -g npm:cueloop" },
  { id: "nix", label: "nix", command: "nix run github:mmurakaru/cueloop" },
];

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable; the command stays visible to copy by hand
    }
  }
  return (
    <div className="install__cmd">
      <span className="install__prompt" aria-hidden="true">
        $
      </span>
      <code className="install__text">{command}</code>
      <Button
        className="install__copy"
        aria-label={copied ? "Copied" : `Copy: ${command}`}
        onPress={copy}
      >
        {copied ? "copied" : "copy"}
      </Button>
    </div>
  );
}

export default function InstallTabs() {
  return (
    <Tabs className="install">
      <TabList className="install__tabs" aria-label="Install method">
        {METHODS.map((method) => (
          <Tab key={method.id} id={method.id} className="install__tab">
            {method.label}
          </Tab>
        ))}
      </TabList>
      {METHODS.map((method) => (
        <TabPanel key={method.id} id={method.id} className="install__panel">
          <CommandRow command={method.command} />
        </TabPanel>
      ))}
    </Tabs>
  );
}
