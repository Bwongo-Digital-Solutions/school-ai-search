import * as React from "react"
import { createContext, useContext, useEffect, useMemo, useState } from "react"

export type Theme = "dark" | "light" | "system"

/**
 * This provider is hand-written — it only ever borrowed its props type from next-themes, which is
 * otherwise unused. Declared here so the dependency could go with the rest of the old design system.
 */
interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  /** Accepted and ignored, for compatibility with the shape callers were written against. */
  value?: unknown
}

type ThemeContextType = {
  /** What the reader chose: an explicit theme, or "system" to follow the device. */
  theme: Theme
  setTheme: (theme: Theme) => void
  /**
   * What that actually resolves to right now.
   *
   * The one source of truth for "are we dark?", because it is the only place subscribed to the
   * media query. Two components each computing it from `matchMedia(...).matches` at render time is
   * what previously let the header and the body disagree under "system": the query is read once,
   * nothing re-renders when the device flips, and only one of them happens to be re-rendered by
   * something else. Read this instead of asking the browser again.
   */
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextType | null>(null)

const DARK_QUERY = "(prefers-color-scheme: dark)"

const systemPrefersDark = () =>
  typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("theme")
      return (savedTheme && (savedTheme === "dark" || savedTheme === "light" || savedTheme === "system")
        ? savedTheme
        : defaultTheme) as Theme
    }
    return defaultTheme as Theme
  })

  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  // Watched, not merely read: the device can change theme while the app is open — on a schedule, at
  // sunset, or because someone flipped a switch — and a theme that only updates on reload is a
  // theme that is wrong half the time. Subscribed unconditionally rather than only under "system",
  // so switching back to "system" does not first need a device change to become correct.
  useEffect(() => {
    if (typeof window === "undefined") return
    const query = window.matchMedia(DARK_QUERY)
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  const isDark = theme === "dark" || (theme === "system" && systemDark)

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(isDark ? "dark" : "light")

    // The parts of the page the app does not paint: scrollbars, native form controls, the canvas
    // behind an overscroll. Left at `light dark` in index.css they follow the device even when the
    // reader has explicitly chosen otherwise, which is how you end up with a white scrollbar down
    // the side of a dark app.
    root.style.colorScheme = isDark ? "dark" : "light"
  }, [isDark])

  const value = useMemo<ThemeContextType>(
    () => ({
      theme,
      isDark,
      setTheme: (next: Theme) => {
        localStorage.setItem("theme", next)
        setTheme(next)
      },
    }),
    [theme, isDark],
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}
