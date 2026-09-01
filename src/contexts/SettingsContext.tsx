import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { EMPTY_SETTINGS, fetchSchoolSettings, type SchoolSettings } from '@/lib/settings';
import { applyBrand } from '@/lib/brand';
import { useTheme } from '@/components/theme-provider';

interface SettingsContextType {
  settings: SchoolSettings;
  refreshSettings: () => Promise<void>;
  setSettings: (settings: SchoolSettings) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within SettingsProvider');
  return context;
};

/**
 * Holds the school's global branding so the header, footer and document flows all read one source.
 * Loaded once on mount; refreshed after an admin saves under Settings.
 */
export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<SchoolSettings>(EMPTY_SETTINGS);
  const { isDark } = useTheme();

  const refreshSettings = useCallback(async () => {
    setSettings(await fetchSchoolSettings());
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  // The school's colour, onto the document, for every stylesheet to read as var(--brand-01/02/03).
  // Kept here rather than in a component so it survives navigation and applies to portals — Carbon
  // renders modals and overflow menus outside the React tree, and they need the brand too.
  //
  // Re-applied when the theme changes, not only when the school's colour does: the three shades are
  // derived differently on a dark ground, so the same setting yields different values.
  useEffect(() => {
    applyBrand(settings.theme_color, isDark);
  }, [settings.theme_color, isDark]);

  return (
    <SettingsContext.Provider value={{ settings, refreshSettings, setSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
