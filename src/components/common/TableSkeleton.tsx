import React from 'react';
import { DataTableSkeleton } from '@carbon/react';

interface TableSkeletonProps {
  rowCount?: number;
  columnCount?: number;
  /**
   * The real column labels. Carbon renders these as text while the body cells stay skeleton bars,
   * so the reader can read the table's shape — "Student · Class · Balance · Oldest due" — before any
   * of it arrives. Sets `columnCount` when that is not given separately.
   */
  columnLabels?: string[];
  /** Row height, to match the table being stood in for. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Off when the skeleton sits inside a card that already has its own CardHeader. */
  showHeader?: boolean;
  showToolbar?: boolean;
}

/**
 * A table that has not arrived yet.
 *
 * Given the shape of the real table rather than a spinner, so the page does not jump when the data
 * lands — the columns are already the right width and the rows already in the right place. Pass the
 * counts the real table will have; the default of five by five suits most of the lists here, and
 * `columnLabels` is better still where the headings are known.
 *
 * When to show one, and what to show instead, is set out on `ListSkeleton`.
 */
export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  rowCount = 5,
  columnCount,
  columnLabels,
  size,
  showHeader = false,
  showToolbar = false,
}) => (
  <DataTableSkeleton
    zebra
    rowCount={rowCount}
    columnCount={columnCount ?? columnLabels?.length ?? 5}
    headers={columnLabels?.map((header) => ({ header }))}
    size={size}
    showHeader={showHeader}
    showToolbar={showToolbar}
  />
);

export default TableSkeleton;
