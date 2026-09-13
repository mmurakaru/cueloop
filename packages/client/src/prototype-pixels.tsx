/**
 * Lazy boundary for the opt-in kitty pixel prototype. The pixel path pulls in the
 * kitty image writer, the headless-browser renderer, and (on first paint) puppeteer;
 * none of that belongs in the runtime unless the `[experimental] prototype_pixels`
 * flag is on. Importing only the TYPE here is erased at build time, so the real
 * module - and its dependencies - loads only when this component actually mounts,
 * which App does exclusively for a pixel prototype. This lives outside components/
 * on purpose: it is an app boundary, not a visual component the story catalog covers.
 */

import React, { useEffect, useState } from "react";
import type { PrototypeContentViewProps } from "./components/PrototypeContentView";

type PixelPrototypeView = (typeof import("./components/PrototypeContentView"))["PrototypeContentView"];

export function PrototypePixels(props: PrototypeContentViewProps): React.ReactNode {
  const [View, setView] = useState<PixelPrototypeView | null>(null);

  useEffect(() => {
    let alive = true;

    void import("./components/PrototypeContentView").then((module) => {
      if (alive) setView(() => module.PrototypeContentView);
    });

    return () => {
      alive = false;
    };
  }, []);

  if (!View) return null;

  return <View {...props} />;
}
