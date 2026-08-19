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
