import { runHarnessBridge } from "@cueloop/adapters/harness-bridge";

export async function harnessCommand(): Promise<number> {
  try {
    const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
    const response = await runHarnessBridge(request);

    console.log(JSON.stringify(response));

    return 0;
  } catch (error) {
    console.error(`cueloop harness bridge failed: ${String(error)}`);

    return 1;
  }
}
