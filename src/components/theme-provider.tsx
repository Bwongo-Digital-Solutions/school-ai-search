import * as React from "react"
import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"

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
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

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

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"
      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  const value: ThemeContextType = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem("theme", theme)
      setTheme(theme)
    },
  }

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
