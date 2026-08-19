/**
 * Shared display formatting. These were each defined two or three times across the chat
 * components; keep new code importing from here so money and dates read the same everywhere.
 */

/** Fees are whole-shilling amounts in practice, so cents would be noise on every screen. */
export const formatAmount = (amount: number, currency: string) =>
  `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`;

export const formatDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
};

export const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 16).replace('T', ' ');
};

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const addDaysIso = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** The school year runs across two calendar years, written the way the records screens write it. */
export const academicYear = () => {
  const year = new Date().getFullYear();
  return `${year}/${year + 1}`;
};

export const TERMS = ['Term 1', 'Term 2', 'Term 3'];
