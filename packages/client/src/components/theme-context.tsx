/**
 * Provider theming for the component system. The context default is the
 * built-in dark theme, so embedding a component (or rendering a story) needs
 * no provider at all. One ThemeProvider swap switches the live theme; every
 * component also accepts an optional `theme` prop that overrides the context
 * for explicit control. Components consume named tokens only - a hardcoded
 * color inside components/ is a review rejection.
 */

import React, { createContext, useContext } from "react";
import { DARK, type Theme } from "../theme";

const ThemeContext = createContext<Theme>(DARK);

export function ThemeProvider({
  theme,
  children,
}: {
  theme: Theme;
  children: React.ReactNode;
}): React.ReactNode {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Token resolution for a component: the explicit `theme` prop wins over the
 * provider context, which defaults to the built-in dark theme.
 */
export function useComponentTheme(override?: Theme): Theme {
  const contextTheme = useContext(ThemeContext);
  return override ?? contextTheme;
}
