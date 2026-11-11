export const BOMBADIL_READY_TITLE = "READY";
export const BOMBADIL_DRAFT_TEXT = "Ω界🙂";
export const BOMBADIL_SCENARIOS = ["plan", "diff", "draft", "negative-control"] as const;

export type BombadilScenario = (typeof BOMBADIL_SCENARIOS)[number];
