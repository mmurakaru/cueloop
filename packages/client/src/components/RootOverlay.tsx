// A root overlay slot: OpenTUI has no z-index, so an overlay drawn inside a pane is sliced by the
// next pane's border. Anything pushed here renders after every pane (last in draw order), so it sits
// on top of the whole shell - the same trick the tooltip uses. Callers position their node with
// absolute screen coordinates and hold a stable key, so several overlays (a menu, a hover preview)
// coexist instead of clobbering one shared slot.

import React, { createContext, useContext, useMemo, useState } from "react";

interface RootOverlayApi {
  setOverlay: (key: string, node: React.ReactNode) => void;
  clearOverlay: (key: string) => void;
}

const RootOverlayContext = createContext<RootOverlayApi>({
  setOverlay: () => {},
  clearOverlay: () => {},
});

export function useRootOverlay(): RootOverlayApi {
  return useContext(RootOverlayContext);
}

export function RootOverlayProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [overlays, setOverlays] = useState<Map<string, React.ReactNode>>(new Map());
  const api = useMemo<RootOverlayApi>(
    () => ({
      setOverlay: (key, node) => setOverlays((current) => new Map(current).set(key, node)),
      clearOverlay: (key) =>
        setOverlays((current) => {
          if (!current.has(key)) return current;
          const next = new Map(current);
          next.delete(key);

          return next;
        }),
    }),
    [],
  );

  return (
    <RootOverlayContext.Provider value={api}>
      {children}
      {[...overlays].map(([key, node]) => (
        <React.Fragment key={key}>{node}</React.Fragment>
      ))}
    </RootOverlayContext.Provider>
  );
}
