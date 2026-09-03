import React from 'react';
import { SkeletonText } from '@carbon/react';
import styles from './list-skeleton.module.scss';

interface ListSkeletonProps {
  /** How many rows to stand in for. Pass the list's page size, capped at what fits on a screen. */
  rowCount?: number;
  /** Two lines matches a title-and-detail row; one matches a compact register. */
  lines?: 1 | 2;
  /** Taller rows, for the card-shaped lists like the question bank. */
  variant?: 'row' | 'card';
}

/**
 * A list that has not arrived yet.
 *
 * The counterpart to `TableSkeleton` for the hand-built row lists — the ones that are a stack of
 * bordered divs rather than a `<table>`, which is most of them here. Carbon's `DataTableSkeleton`
 * emits a real data table, so using it inside one of those panels is the wrong element and looks it.
 *
 * ## When a screen shows what
 *
 * Every list in the app resolves in this order, and the order is the point: a reader must never be
 * shown "there is nothing here" for something that is merely still coming.
 *
 * ```
 * loading && rows.length === 0   →  a skeleton, in the shape of what is coming
 * error                          →  ErrorState, with onRetry where a retry could work
 * not yet asked                  →  the screen's own prompt ("Select a student…")
 * rows.length === 0              →  EmptyState
 * otherwise                      →  the rows
 * ```
 *
 * Two things about that first line are easy to get wrong:
 *
 *   - **`loading && rows.length === 0`, never a bare `loading`.** A refresh keeps the last-good list
 *     on screen instead of throwing the reader back to a skeleton — and back to page 1, since
 *     `usePagedRows` resets when the row count changes.
 *   - **`useState(true)`.** A `loading` that starts false means the first paint is the empty state,
 *     which is the whole defect this exists to fix.
 *
 * `InlineLoading` is not part of this. It belongs to actions — a save in progress, a report being
 * built — where there is no shape to stand in for.
 */
export const ListSkeleton: React.FC<ListSkeletonProps> = ({
  rowCount = 5,
  lines = 2,
  variant = 'row',
}) => (
  <div aria-busy="true" aria-live="polite">
    {Array.from({ length: rowCount }, (_, index) => (
      <div key={index} className={variant === 'card' ? styles.card : styles.row}>
        <SkeletonText heading width="40%" className={styles.line} />
        {lines === 2 && <SkeletonText width="70%" className={styles.line} />}
      </div>
    ))}
  </div>
);

export default ListSkeleton;
