/**
 * The shared pieces every screen is built from.
 *
 * A small set, used everywhere, is what makes an app of this size look like one product: the same
 * card, the same section title with the school's colour under it, the same thing shown when a list
 * is empty. Screens compose these rather than assembling their own layout out of divs.
 */
export { default as AccessDenied } from './AccessDenied';
export { default as CardHeader } from './CardHeader';
export { default as ColorPicker } from './ColorPicker';
export { default as EmptyState } from './EmptyState';
export { default as EmptyStateIllustration } from './EmptyStateIllustration';
export { default as ErrorState } from './ErrorState';
export { default as ImagePicker } from './ImagePicker';
export { default as Field, type FieldValue, type FieldChange } from './Field';
export { default as PageHeader } from './PageHeader';
export { default as StatTile, StatRow } from './StatTile';
export { default as StudentPicker } from './StudentPicker';
export { default as TablePager } from './TablePager';
export { default as TableSkeleton } from './TableSkeleton';
export { default as WidgetCard } from './WidgetCard';
