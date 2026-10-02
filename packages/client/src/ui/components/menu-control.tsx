// One open menu at a time across a shell: the thread row menu and the editor split menu share this
// single open id, so opening either closes the other. Owned by App and by the no-thread shell, one each.

import React, { createContext, useContext, useMemo, useState } from "react";

export interface MenuControlApi {
  openMenuId: string | null;
  toggleMenu: (id: string) => void;
  closeMenu: () => void;
}

const MenuControlContext = createContext<MenuControlApi>({
  openMenuId: null,
  toggleMenu: () => {},
  closeMenu: () => {},
});

export function useMenuControl(): MenuControlApi {
  return useContext(MenuControlContext);
}

export function useMenuControlState(): MenuControlApi {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  return useMemo(
    () => ({
      openMenuId,
      toggleMenu: (id: string) => setOpenMenuId((current) => (current === id ? null : id)),
      closeMenu: () => setOpenMenuId(null),
    }),
    [openMenuId],
  );
}

export function MenuControlProvider({
  value,
  children,
}: {
  value: MenuControlApi;
  children: React.ReactNode;
}): React.ReactNode {
  return <MenuControlContext.Provider value={value}>{children}</MenuControlContext.Provider>;
}
