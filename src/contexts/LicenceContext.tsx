import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  fetchEntitlements,
  UNKNOWN_ENTITLEMENTS,
  type Entitlements,
  type FeatureEntitlement,
} from '@/lib/licence';

interface LicenceContextType {
  entitlements: Entitlements;
  /** Whether this school's plan includes a feature. Unknown keys are allowed — see below. */
  allows: (feature: string) => boolean;
  /** The whole entitlement, for a screen that wants to say *why* rather than just hide something. */
  entitlement: (feature: string) => FeatureEntitlement | null;
  refreshLicence: () => Promise<void>;
  licenceError: string | null;
}

const LicenceContext = createContext<LicenceContextType | undefined>(undefined);

export const useLicence = () => {
  const context = useContext(LicenceContext);
  if (!context) throw new Error('useLicence must be used within LicenceProvider');
  return context;
};

/**
 * What this school has paid for, held once for the whole application.
 *
 * The server enforces this; the client's job is only to stop offering what is not there. So every
 * uncertainty resolves *open*: a feature key the server did not mention, a request that failed, a
 * licence not loaded yet. A wrong "yes" here costs a clear message from the server when the button
 * is pressed. A wrong "no" blacks out a screen the school is paying for, and leaves nobody any way
 * to tell that it was the browser's mistake.
 */
export const LicenceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [entitlements, setEntitlements] = useState<Entitlements>(UNKNOWN_ENTITLEMENTS);
  const [licenceError, setLicenceError] = useState<string | null>(null);

  const refreshLicence = useCallback(async () => {
    try {
      setEntitlements(await fetchEntitlements());
      setLicenceError(null);
    } catch (err) {
      console.error('Could not read the licence:', err);
      setLicenceError(err instanceof Error ? err.message : 'The licence could not be read');
      // The last good value is kept. A reload that fails should not take a working nav down with it.
    }
  }, []);

  useEffect(() => { refreshLicence(); }, [refreshLicence]);

  const value = useMemo<LicenceContextType>(() => ({
    entitlements,
    allows: (feature: string) => entitlements.features[feature]?.allowed ?? true,
    entitlement: (feature: string) => entitlements.features[feature] ?? null,
    refreshLicence,
    licenceError,
  }), [entitlements, licenceError, refreshLicence]);

  return <LicenceContext.Provider value={value}>{children}</LicenceContext.Provider>;
};
