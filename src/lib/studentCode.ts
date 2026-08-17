/**
 * Normalises a scanned student ID card payload down to the student number.
 *
 * Mirrors `parseStudentCode` in server/local-backend.mjs — keep the two in sync. The server
 * re-parses anything it receives, so this copy only exists for client-side filtering.
 */
export const parseStudentCode = (raw: string): string => {
  const text = (raw ?? '').trim();
  if (!text) return '';

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const fromJson = parsed.student_id || parsed.studentId || parsed.id || parsed.code;
      if (fromJson) return String(fromJson).trim();
    } catch {
      // Fall through and treat the payload as plain text.
    }
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const fromQuery =
        url.searchParams.get('student_id') || url.searchParams.get('studentId') || url.searchParams.get('id');
      if (fromQuery) return fromQuery.trim();
      const lastSegment = url.pathname.split('/').filter(Boolean).pop();
      if (lastSegment) return decodeURIComponent(lastSegment).trim();
    } catch {
      // Fall through and treat the payload as plain text.
    }
  }

  return text;
};
