import { BOMBADIL_READY_TITLE, BOMBADIL_DRAFT_TEXT } from "./fixture-contract.ts";
import { always, eventually, now } from "@antithesishq/bombadil";
import { CharSet } from "@antithesishq/bombadil/actions";
import { actions, weighted } from "@antithesishq/bombadil/terminal";
import { reviewScreen } from "./terminal-state.ts";

export {
  reviewBecomesReady,
  reviewRemainsRunning,
  reviewRecoversAfterInput,
} from "./terminal-state.ts";
export { noReplacementChars } from "@antithesishq/bombadil/terminal/defaults/properties";

const closeOrResize = weighted([
  [4, { TypeText: { CharSet: CharSet.fromLiterals("\x1b") } }],
  [1, { Resize: { columns: [80, 144], rows: [24, 44] } }],
]);

export const unicodeDraftAppears = always(
  now(() => {
    const action = reviewScreen.current.lastAction;

    return action !== null && "TypeText" in action && action.TypeText === BOMBADIL_DRAFT_TEXT;
  }).implies(
    eventually(() => reviewScreen.current.text.includes(BOMBADIL_DRAFT_TEXT)).within(1, "seconds"),
  ),
);

export const editAndDiscardDraft = actions(() => {
  if (!reviewScreen.current.text.includes(BOMBADIL_READY_TITLE)) {
    return [{ TypeText: { Regexp: "" } }];
  }

  if (reviewScreen.current.text.includes(BOMBADIL_DRAFT_TEXT)) return closeOrResize.generate();

  return [{ TypeText: { CharSet: CharSet.fromLiterals(BOMBADIL_DRAFT_TEXT) } }];
});
