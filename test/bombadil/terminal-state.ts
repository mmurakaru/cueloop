import { BOMBADIL_READY_TITLE } from "./fixture-contract.ts";
import { always, eventually, extract, next, now } from "@antithesishq/bombadil";
import type { State } from "@antithesishq/bombadil/terminal";
import { hasBombadilReviewContent } from "./review-content.ts";

export const reviewScreen = extract((state: State) => ({
  text: Array.from({ length: state.grid.size.rows }, (_, row) => state.grid.rowText(row)).join(
    "\n",
  ),
  rows: state.grid.size.rows,
  columns: state.grid.size.columns,
  exitStatus: state.exitStatus,
  lastAction: state.lastAction,
})).named("reviewScreen");

export const reviewBecomesReady = eventually(() =>
  hasBombadilReviewContent(reviewScreen.current.text),
).within(10, "seconds");

export const reviewRemainsRunning = always(() => reviewScreen.current.exitStatus === null);

export const reviewRecoversAfterInput = always(
  now(() => reviewScreen.current.text.includes(BOMBADIL_READY_TITLE)).implies(
    next(
      eventually(() => hasBombadilReviewContent(reviewScreen.current.text)).within(2, "seconds"),
    ),
  ),
);
