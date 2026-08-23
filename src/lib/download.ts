/**
 * Fetches a generated document and hands it to the browser as a download.
 *
 * Goes through fetch rather than a plain link so a non-200 surfaces as an error the caller can
 * show, instead of the browser quietly saving an error page as a .pdf.
 */
export const downloadFromUrl = async (url: string, filename: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to build ${filename} (${response.status})`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
};

/**
 * Fetches a generated document and opens the browser's print dialog on it.
 *
 * Goes through fetch and a blob rather than pointing a window at the URL directly, for the same
 * reason downloadFromUrl does: a non-200 surfaces as an error the caller can show, instead of the
 * browser printing an error page. The hidden iframe keeps the current screen in place — a teacher
 * printing a report should not lose the conversation they are looking at.
 */
export const printFromUrl = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not build the document to print (${response.status})`);
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.src = objectUrl;

  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      // Some browsers refuse to drive print on a blob frame; fall back to a new tab, where the
      // reader can print from the viewer's own controls.
      window.open(objectUrl, '_blank', 'noopener');
    }
    // Left in the DOM long enough for the dialog to take hold; removing it immediately cancels it.
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(objectUrl);
    }, 60_000);
  };

  document.body.appendChild(frame);
};
