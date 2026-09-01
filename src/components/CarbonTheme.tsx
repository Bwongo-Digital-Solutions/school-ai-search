import React, { useEffect, useState } from 'react';
import { Theme } from '@carbon/react';
import { useTheme } from './theme-provider';

/**
 * Puts the app inside a Carbon theme, following whichever one the user already chose.
 *
 * Carbon does not read the `dark` class on `<html>` that Tailwind uses — it sets its tokens as CSS
 * custom properties on whatever element `<Theme>` renders. So the existing light/dark toggle stays
 * the single control and this translates it, rather than the app growing a second theme switch.
 *
 * `g10` and `g100` rather than `white` and `g90`: g10's very slightly grey background is what keeps
 * white cards and panels reading as raised surfaces instead of dissolving into the page, and g100 is
 * the darker of the two dark themes, closest to the near-black this app already used.
 *
 * The `system` setting has to be watched, not just read: it can change under the app while it is
 * open, and a theme that only updates on reload is a theme that is wrong half the time.
 */
const CarbonTheme: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useTheme();
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const dark = theme === 'dark' || (theme === 'system' && systemDark);

  return (
    // `display: contents` so this wrapper carries the theme's CSS custom properties to everything
    // below it without becoming a box of its own. A themed <div> in the middle of the tree is an
    // extra layout participant, and the app's height chain runs straight from #root to the layout.
    <Theme theme={dark ? 'g100' : 'g10'} style={{ display: 'contents' }}>
      {children}
    </Theme>
  );
};

export default CarbonTheme;
