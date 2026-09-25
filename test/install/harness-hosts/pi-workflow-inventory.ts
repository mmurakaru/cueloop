import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function recordCueloopWorkflows(pi: ExtensionAPI): void {
  pi.registerCommand("cueloop-smoke", {
    handler: async () => {
      const path = process.env.CUELOOP_TEST_PI_WORKFLOWS_FILE;

      if (!path) throw new Error("CUELOOP_TEST_PI_WORKFLOWS_FILE is required");
      writeFileSync(
        path,
        JSON.stringify(pi.getAllTools().map(({ name, parameters }) => ({ name, parameters }))),
      );
    },
  });
}
