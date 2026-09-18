/** A composer with the "/" actions-and-skills palette, sharing the inline-comment edit experience. */

import React, { useContext, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Theme } from "../theme";
import type { QuickAction } from "../config";
import { SlashSkillsContext } from "../skills";
import {
  activeSlashToken,
  insertSlashItem,
  mergeSlashItems,
  slashFilter,
  slashItemsFrom,
} from "../slash-palette";
import { Composer, ComposerPalette } from "./AnnotationCards";

export interface SlashComposerProps {
  seed: string;
  glyph: string;
  quickActions: QuickAction[];
  tokens: Theme;
  onSubmit: (text: string) => void;
  onInput?: (text: string) => void;
}

export function SlashComposer({
  seed,
  glyph,
  quickActions,
  tokens,
  onSubmit,
  onInput,
}: SlashComposerProps): React.ReactNode {
  const skills = useContext(SlashSkillsContext);
  const [mountSeed, setMountSeed] = useState(seed);
  const [text, setText] = useState(seed);
  const [caret, setCaret] = useState(seed.length);
  const [slashIndex, setSlashIndex] = useState(0);

  const paletteItems = mergeSlashItems(slashItemsFrom(quickActions), skills);
  const token = activeSlashToken(text, caret);
  const items = token !== null ? slashFilter(paletteItems, token.slice(1)) : [];
  const slashActive = token !== null && items.length > 0;

  useKeyboard((key) => {
    if (!slashActive) return;
    const selected = Math.min(slashIndex, items.length - 1);

    if (key.name === "up") return setSlashIndex(Math.max(0, selected - 1));
    if (key.name === "down") return setSlashIndex(Math.min(items.length - 1, selected + 1));
    if (key.name === "tab" || (key.name === "return" && !key.meta && !key.ctrl && !key.super)) {
      const inserted = insertSlashItem(text, caret, items[selected]!.name);

      setMountSeed(inserted.text);
      setText(inserted.text);
      setCaret(inserted.caret);
      onInput?.(inserted.text);
    }
  });

  return (
    <box style={{ flexDirection: "column" }}>
      <Composer
        key={mountSeed}
        seed={mountSeed}
        glyph={glyph}
        tokens={tokens}
        onReady={() => {}}
        onSave={onSubmit}
        onInput={(next, nextCaret) => {
          setText(next);
          setCaret(nextCaret);
          onInput?.(next);
        }}
      />
      <ComposerPalette
        slashActive={slashActive}
        slashItems={items}
        slashIndex={slashIndex}
        tokens={tokens}
      />
    </box>
  );
}
