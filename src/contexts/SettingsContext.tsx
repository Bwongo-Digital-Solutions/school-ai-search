import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { EMPTY_SETTINGS, fetchSchoolSettings, type SchoolSettings } from '@/lib/settings';

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

  const refreshSettings = useCallback(async () => {
    setSettings(await fetchSchoolSettings());
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  return (
    <SettingsContext.Provider value={{ settings, refreshSettings, setSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
