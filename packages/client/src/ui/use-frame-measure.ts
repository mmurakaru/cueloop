/**
 * Read a layout-dependent value after every rendered frame (and resize),
 * committing only on change. Layout lands after the commit, so a timer
 * would race the visual-idle wait; measuring on the frame event converges
 * deterministically within a frame or two.
 */

import { useEffect, useState } from "react";
import { useRenderer } from "@opentui/react";

type Renderer = NonNullable<ReturnType<typeof useRenderer>>;
type Measure = () => void;

interface FrameSubscriptions {
  measures: Set<Measure>;
  notify: Measure;
}

const subscribers = new WeakMap<Renderer, FrameSubscriptions>();

export function subscribeToFrames(renderer: Renderer, measure: Measure): () => void {
  let subscription = subscribers.get(renderer);

  if (!subscription) {
    const measures = new Set<Measure>();
    const notify = (): void => {
      for (const subscriber of measures) subscriber();
    };

    subscription = { measures, notify };
    subscribers.set(renderer, subscription);
    renderer.on("frame", notify);
    renderer.on("resize", notify);
  }

  const { measures, notify } = subscription;

  measures.add(measure);

  return () => {
    measures.delete(measure);

    if (measures.size > 0) return;

    renderer.off("frame", notify);
    renderer.off("resize", notify);
    subscribers.delete(renderer);
  };
}

export function useFrameMeasure<T>(
  read: () => T,
  isEqual: (left: T, right: T) => boolean,
  initial: T,
  active = true,
): T {
  const renderer = useRenderer();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    // a measurement only needed while a popover is open subscribes no per-frame listener when closed
    if (!active) return;

    const measure = (): void => {
      const next = read();

      setValue((current) => (isEqual(current, next) ? current : next));
    };

    measure();

    if (renderer) return subscribeToFrames(renderer, measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, active]);

  return value;
}
