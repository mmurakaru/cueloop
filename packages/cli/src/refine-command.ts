/** CLI wrapper around the shared corpus analysis used by harness refine workflows. */

import { cueloopHome } from "@cueloop/daemon/paths";
import { analyzeRefineCorpus } from "@cueloop/adapters/refine-corpus";
import { parseArgs, stringFlag } from "./args";

/** Generate the same refine report the shared harness controller consumes. */
export async function refineCommand(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv);
  const home = stringFlag(flags, "home") ?? cueloopHome();
  const rawLimit = stringFlag(flags, "limit");
  const result = analyzeRefineCorpus(home, rawLimit === undefined ? undefined : Number(rawLimit));

  console.log(
    JSON.stringify(
      {
        report: result.reportPath,
        timestamped: result.timestampedPath,
        analyzed: result.analyzed,
        total: result.total,
      },
      null,
      2,
    ),
  );

  return 0;
}
