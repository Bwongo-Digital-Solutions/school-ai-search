import { useEffect, useState } from 'react';

/**
 * Which layout the app is being used at.
 *
 * Carbon sizes controls through JavaScript props (`size="sm"` / `size="lg"`), not CSS, so a media
 * query alone cannot make the interface touch-friendly on a tablet — the decision has to be
 * readable from React. This is the same seam OpenMRS gets from `useLayoutType()` in its framework,
 * which this app has no equivalent of.
 *
 * The rule throughout: **tablet gets one or two Carbon size steps larger than desktop**, because
 * fingers need bigger targets than a mouse pointer. A desktop `sm` is a tablet `lg`.
 */
export type LayoutType = 'phone' | 'tablet' | 'desktop';

const TABLET_MAX = 1023;
const PHONE_MAX = 600;

const currentLayout = (): LayoutType => {
  if (typeof window === 'undefined') return 'desktop';
  const width = window.innerWidth;
  if (width <= PHONE_MAX) return 'phone';
  if (width <= TABLET_MAX) return 'tablet';
  return 'desktop';
};

export const useLayoutType = (): LayoutType => {
  const [layout, setLayout] = useState<LayoutType>(currentLayout);

  useEffect(() => {
    const onResize = () => setLayout(currentLayout());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return layout;
};

/** True on a desktop-width screen. Phones are treated as tablets: both are touch. */
export const useIsDesktop = () => useLayoutType() === 'desktop';

/**
 * The Carbon `size` for a control, at the current layout.
 *
 * Passing this rather than a literal is what keeps the whole app's density consistent, and is the
 * single most repeated idiom in the OpenMRS codebase.
 */
export const useResponsiveSize = (): 'sm' | 'lg' => (useIsDesktop() ? 'sm' : 'lg');
