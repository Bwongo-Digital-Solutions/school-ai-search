import { useEffect, useMemo, useState } from 'react';

/**
 * A page of a list that is already in memory.
 *
 * Most lists in this app are: the roster arrives whole, the fee reports have no server-side limit,
 * and a student's own records are a handful of rows. Paging those is a `slice`, and doing it on the
 * server would be a round trip bought for nothing.
 *
 * The two effects are the part worth having in one place rather than rewritten each time, because
 * both are only noticed when they are missing:
 *
 *   - **Reset when the list changes.** Search for a name while reading page 4 and, without this,
 *     you get page 4 of two results — a blank table that reads as "no matches".
 *   - **Clamp when it shrinks.** Delete the last row on the last page and the page you are on stops
 *     existing. Same blank table, and this time nothing the reader did explains it.
 *
 * Lifted from the admissions register in StudentRecordsWorkspace, which was the only list in the
 * app that paged at all and had both of these written by hand.
 */
export const usePagedRows = <T,>(rows: readonly T[], pageSize: number) => {
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  // Keyed on the length rather than the array: a re-render that rebuilds the same rows should not
  // throw the reader back to page 1, but a filter that changes how many there are should.
  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  return {
    page,
    setPage,
    pageCount,
    pageRows,
    total: rows.length,
    /** The 1-based range on show, for "1–25 of 340". Both zero when the list is empty. */
    firstOnPage: rows.length === 0 ? 0 : (page - 1) * pageSize + 1,
    lastOnPage: Math.min(page * pageSize, rows.length),
  };
};

export default usePagedRows;
