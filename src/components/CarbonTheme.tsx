import React from 'react';
import { Theme } from '@carbon/react';
import { useTheme } from './theme-provider';

/**
 * Puts the app inside a Carbon theme, following whichever one the reader already chose.
 *
 * `g10` and `g100` rather than `white` and `g90`: g10's very slightly grey background is what keeps
 * white cards and panels reading as raised surfaces instead of dissolving into the page, and g100 is
 * the darker of the two dark themes, closest to the near-black this app already used.
 *
 * This is what makes every hand-written stylesheet theme-aware, because <Theme> sets Carbon's whole
 * token set as CSS custom properties on the element it renders — and styles/_vars.scss defines the
 * app's own tokens in terms of those. It also adds the `cds--g100` class the dark overrides key off.
 * Both halves matter: the class without the properties themes only Carbon's components, which is
 * exactly the state this app was in.
 *
 * `isDark` comes from the provider rather than being recomputed here, so there is one subscription
 * to the media query and one answer.
 */
const CarbonTheme: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isDark } = useTheme();

  return (
    // `display: contents` so this wrapper carries the theme's CSS custom properties to everything
    // below it without becoming a box of its own. A themed <div> in the middle of the tree is an
    // extra layout participant, and the app's height chain runs straight from #root to the layout.
    <Theme theme={isDark ? 'g100' : 'g10'} style={{ display: 'contents' }}>
      {children}
    </Theme>
  );
};

export default CarbonTheme;
