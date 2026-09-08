// A root overlay slot: OpenTUI has no z-index, so an overlay drawn inside a pane is sliced by the
// next pane's border. Anything pushed here renders after every pane (last in draw order), so it sits
// on top of the whole shell - the same trick the tooltip uses. Callers position their node with
// absolute screen coordinates.

import React, { createContext, useContext, useMemo, useState } from "react";

interface RootOverlayApi {
  setOverlay: (node: React.ReactNode) => void;
  clearOverlay: () => void;
}

const RootOverlayContext = createContext<RootOverlayApi>({
  setOverlay: () => {},
  clearOverlay: () => {},
});

export function useRootOverlay(): RootOverlayApi {
  return useContext(RootOverlayContext);
}

export function RootOverlayProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [overlay, setOverlay] = useState<React.ReactNode>(null);
  const api = useMemo<RootOverlayApi>(
    () => ({ setOverlay, clearOverlay: () => setOverlay(null) }),
    [],
  );

  return (
    <RootOverlayContext.Provider value={api}>
      {children}
      {overlay}
    </RootOverlayContext.Provider>
  );
}
