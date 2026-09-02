import React from 'react';
import { Button } from '@carbon/react';
import { ChevronLeft, ChevronRight } from '@carbon/react/icons';
import styles from './table-pager.module.scss';

interface TablePagerProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** The 1-based range on show and the size of the whole list, for "1–25 of 340". */
  firstOnPage?: number;
  lastOnPage?: number;
  total?: number;
  /** What is being counted, for the range text. Singular; pluralised by adding an s. */
  noun?: string;
  /** Override when adding an s is wrong — "bursaries", not "bursarys". */
  nounPlural?: string;
}

/**
 * Moving through a list a page at a time.
 *
 * Deliberately not Carbon's `Pagination`, which is a full-width bar with a page-size select and a
 * jump-to-page field. That is right at the foot of a dense data table and wrong in a card header,
 * where it dwarfs the title — and every list in this app that needs paging lives in a card. This is
 * the compact form the admissions register already used, made shareable.
 *
 * It always says how many there are in total. A pager that shows only "Page 2 of 9" leaves the
 * reader to multiply, and a list that says "142 students" while showing twenty-five needs to
 * account for the other hundred and seventeen.
 */
export const TablePager: React.FC<TablePagerProps> = ({
  page,
  pageCount,
  onPageChange,
  firstOnPage,
  lastOnPage,
  total,
  noun,
  nounPlural,
}) => {
  const hasRange = typeof firstOnPage === 'number' && typeof lastOnPage === 'number' && typeof total === 'number';
  const plural = nounPlural || (noun ? `${noun}s` : '');

  return (
    <div className={styles.pager}>
      {hasRange && (
        <span className={styles.range}>
          {total === 0
            ? `No ${plural || 'items'}`
            : `${firstOnPage}–${lastOnPage} of ${total}${noun ? ` ${total === 1 ? noun : plural}` : ''}`}
        </span>
      )}

      {/* Hidden rather than disabled when there is only one page: a dead control is still a control,
          and it invites the reader to work out why it does nothing. */}
      {pageCount > 1 && (
        <>
          <Button
            hasIconOnly
            kind="ghost"
            size="sm"
            renderIcon={ChevronLeft}
            iconDescription="Previous page"
            tooltipPosition="bottom"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
          />
          <span className={styles.position}>
            Page {page} of {pageCount}
          </span>
          <Button
            hasIconOnly
            kind="ghost"
            size="sm"
            renderIcon={ChevronRight}
            iconDescription="Next page"
            tooltipPosition="bottom"
            onClick={() => onPageChange(Math.min(pageCount, page + 1))}
            disabled={page === pageCount}
          />
        </>
      )}
    </div>
  );
};

export default TablePager;
