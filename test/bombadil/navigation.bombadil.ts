import { BOMBADIL_READY_TITLE } from "./fixture-contract.ts";
import { CharSet } from "@antithesishq/bombadil/actions";
import { actions, weighted } from "@antithesishq/bombadil/terminal";
import { reviewScreen } from "./terminal-state.ts";

export {
  reviewBecomesReady,
  reviewRemainsRunning,
  reviewRecoversAfterInput,
} from "./terminal-state.ts";
export { noReplacementChars } from "@antithesishq/bombadil/terminal/defaults/properties";

const clickFixtureText = actions(() =>
  reviewScreen.current.text.split("\n").flatMap((text, row) => {
    const column = text.search(/Navigation sample|record\d+/);

    if (column < 0) return [];

    return [{ Click: { row, column: Math.min(column + 3, reviewScreen.current.columns - 1) } }];
  }),
);

const navigation = weighted([
  [3, clickFixtureText],
  [8, { TypeText: { CharSet: CharSet.fromLiterals("\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D") } }],
  [
    3,
    {
      TypeText: {
        CharSet: CharSet.fromLiterals(
          "\x1b[H",
          "\x1b[F",
          "\x1b[5~",
          "\x1b[6~",
          "\x1b[1;2A",
          "\x1b[1;2B",
          "\x1b[1;2C",
          "\x1b[1;2D",
          "\x1b",
        ),
      },
    },
  ],
  [2, { Resize: { columns: [80, 144], rows: [24, 44] } }],
]);

export const navigateReview = actions(() => {
  if (!reviewScreen.current.text.includes(BOMBADIL_READY_TITLE)) {
    return [{ TypeText: { Regexp: "" } }];
  }

  return navigation.generate();
});
