/**
 * Tabs / TabList / Tab over the native tab-select renderable. The composition
 * follows the ARIA tabs pattern: Tabs owns the controlled selection
 * (`selectedKey` + `onSelectionChange`), TabList renders the strip, Tab
 * declares one item. Selection stays controlled from outside so the keyboard
 * grammar (not the strip) remains the key owner; clicks map through the
 * native tab geometry.
 */

import React, { createContext, useContext, useEffect, useRef } from "react";
import type { MouseEvent, TabSelectRenderable } from "@opentui/core";
import type { Theme } from "../../theme";
import { useComponentTheme } from "../theme-context";

interface TabsContextValue {
  selectedKey: string;
  onSelectionChange: (key: string) => void;
  /** Text color of the selected tab; defaults to the accent token. */
  selectedColor?: string;
  theme?: Theme;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps {
  selectedKey: string;
  onSelectionChange: (key: string) => void;
  selectedColor?: string;
  theme?: Theme;
  children: React.ReactNode;
}

export function Tabs({ selectedKey, onSelectionChange, selectedColor, theme, children }: TabsProps): React.ReactNode {
  return (
    <TabsContext.Provider value={{ selectedKey, onSelectionChange, selectedColor, theme }}>
      {children}
    </TabsContext.Provider>
  );
}

export interface TabProps {
  id: string;
  children: string;
}

/** Declarative item: TabList collects Tab children into the native strip. */
export function Tab(_props: TabProps): React.ReactNode {
  return null;
}

export interface TabListProps {
  children: React.ReactNode;
}

export function TabList({ children }: TabListProps): React.ReactNode {
  const tabs = useContext(TabsContext);
  if (!tabs) throw new Error("TabList must render inside Tabs");
  const tokens = useComponentTheme(tabs.theme);
  const items: { id: string; label: string }[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement<TabProps>(child) && typeof child.props.id === "string") {
      items.push({ id: child.props.id, label: child.props.children });
    }
  });
  const tabWidth = Math.max(...items.map((item) => item.label.length)) + 2;
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === tabs.selectedKey),
  );
  const stripRef = useRef<TabSelectRenderable | null>(null);
  // selection is controlled: mirror the selected key into the native strip
  useEffect(() => {
    stripRef.current?.setSelectedIndex(selectedIndex);
  }, [selectedIndex, items.length]);
  const onMouseUp = (event: MouseEvent): void => {
    const strip = stripRef.current;
    if (!strip) return;
    const index = Math.floor((event.x - strip.x) / tabWidth);
    const item = items[index];
    if (item) tabs.onSelectionChange(item.id);
  };
  return (
    <tab-select
      ref={stripRef}
      options={items.map((item) => ({ name: item.label, description: "", value: item.id }))}
      tabWidth={tabWidth}
      showUnderline={false}
      showDescription={false}
      showScrollArrows={false}
      textColor={tokens.textDim}
      selectedTextColor={tabs.selectedColor ?? tokens.accent}
      selectedBackgroundColor={tokens.elevated}
      onMouseUp={onMouseUp}
      style={{ height: 1, width: tabWidth * items.length }}
    />
  );
}
