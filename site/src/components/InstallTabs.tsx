/*
 * Install-method picker: a React Aria Tabs widget over the ways to get cueloop
 * (npm, bun, pnpm, brew, mise, nix). Each panel shows one command with its own
 * copy affordance. Keyboard + ARIA come from react-aria-components; the visual
 * is a bordered terminal-style field with crop-marks.
 */
import { Tabs, TabList, Tab, TabPanel, Button } from "react-aria-components";
import { useEffect, useState } from "react";
import MetalRing from "./MetalRing.tsx";

// Mirror the site's manual [data-theme] so the metal shader picks the matching
// dark/light preset tuning instead of following the OS.
function useSiteTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

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

function CommandRow({ command, metal }: { command: string; metal?: boolean }) {
  const [copied, setCopied] = useState(false);
  const theme = useSiteTheme();
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable; the command stays visible to copy by hand
    }
  }
  const box = (
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
  // The metal ring is opt-in (landing hero only).
  if (!metal) return box;
  return (
    <MetalRing theme={theme} radius={8} className="install__metal">
      {box}
    </MetalRing>
  );
}

export default function InstallTabs({ metal = false }: { metal?: boolean }) {
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
          <CommandRow command={method.command} metal={metal} />
        </TabPanel>
      ))}
    </Tabs>
  );
}
