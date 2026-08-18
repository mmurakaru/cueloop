/**
 * Tabs / TabList / Tab: a transparent, full-width rounded strip of clickable
 * text tabs. The composition follows the ARIA tabs pattern: Tabs owns the
 * controlled selection (`selectedKey` + `onSelectionChange`), TabList renders
 * the strip, Tab declares one item. Selection stays controlled from outside so
 * the keyboard grammar remains the key owner; each tab click sets the key.
 */

import React, { createContext, useContext } from "react";
import type { Theme } from "../../theme";
import { useComponentTheme } from "../theme-context";
import { FRAME_BORDER_STYLE } from "./frame";

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
  return (
    <box
      style={{ width: "100%", height: 3, border: true, borderStyle: FRAME_BORDER_STYLE, borderColor: tokens.text, flexDirection: "row", paddingLeft: 1 }}
    >
      {items.map((item) => {
        const selected = item.id === tabs.selectedKey;
        return (
          <box key={item.id} style={{ marginRight: 2 }} onMouseUp={() => tabs.onSelectionChange(item.id)}>
            <text fg={selected ? (tabs.selectedColor ?? tokens.accent) : tokens.textDim}>{item.label}</text>
          </box>
        );
      })}
    </box>
  );
}
