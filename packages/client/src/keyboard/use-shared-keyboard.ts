/** One keypress subscription per renderer, even when several editor tiles are mounted. */

import { useEffect, useEffectEvent } from "react";
import { useRenderer } from "@opentui/react";
import type { KeyEvent } from "@opentui/core";

type KeyInput = NonNullable<ReturnType<typeof useRenderer>>["keyInput"];
type KeyHandler = (key: KeyEvent) => void;

interface KeySubscriptions {
  handlers: Set<KeyHandler>;
  notify: KeyHandler;
}

const subscribers = new WeakMap<KeyInput, KeySubscriptions>();

function subscribeToKeypress(input: KeyInput, handler: KeyHandler): () => void {
  let subscription = subscribers.get(input);

  if (!subscription) {
    const handlers = new Set<KeyHandler>();
    const notify = (key: KeyEvent): void => {
      for (const subscriber of handlers) subscriber(key);
    };

    subscription = { handlers, notify };
    subscribers.set(input, subscription);
    input.on("keypress", notify);
  }

  const { handlers, notify } = subscription;

  handlers.add(handler);

  return () => {
    handlers.delete(handler);
    if (handlers.size > 0) return;

    input.off("keypress", notify);
    subscribers.delete(input);
  };
}

export function useSharedKeyboard(handler: KeyHandler): void {
  const renderer = useRenderer();
  const stableHandler = useEffectEvent(handler);

  useEffect(() => {
    const input = renderer?.keyInput;

    if (!input) return;

    return subscribeToKeypress(input, stableHandler);
  }, [renderer]);
}
