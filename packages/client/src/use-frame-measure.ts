/**
 * Read a layout-dependent value after every rendered frame (and resize),
 * committing only on change. Layout lands after the commit, so a timer
 * would race the visual-idle wait; measuring on the frame event converges
 * deterministically within a frame or two.
 */

import { useEffect, useState } from "react";
import { useRenderer } from "@opentui/react";

export function useFrameMeasure<T>(
  read: () => T,
  isEqual: (left: T, right: T) => boolean,
  initial: T,
): T {
  const renderer = useRenderer();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const measure = (): void => {
      const next = read();

      setValue((current) => (isEqual(current, next) ? current : next));
    };

    measure();
    renderer?.on("frame", measure);
    renderer?.on("resize", measure);

    return () => {
      renderer?.off("frame", measure);
      renderer?.off("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer]);

  return value;
}
