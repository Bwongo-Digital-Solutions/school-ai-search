import React from 'react';
import { DataTableSkeleton } from '@carbon/react';

interface TableSkeletonProps {
  rowCount?: number;
  columnCount?: number;
  /** Off when the skeleton sits inside a card that already has its own CardHeader. */
  showHeader?: boolean;
  showToolbar?: boolean;
}

/**
 * A table that has not arrived yet.
 *
 * Given the shape of the real table rather than a spinner, so the page does not jump when the data
 * lands — the columns are already the right width and the rows already in the right place. Pass the
 * counts the real table will have; the default of five by five suits most of the lists here.
 */
export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  rowCount = 5,
  columnCount = 5,
  showHeader = false,
  showToolbar = false,
}) => (
  <DataTableSkeleton
    zebra
    rowCount={rowCount}
    columnCount={columnCount}
    showHeader={showHeader}
    showToolbar={showToolbar}
  />
);

export default TableSkeleton;
