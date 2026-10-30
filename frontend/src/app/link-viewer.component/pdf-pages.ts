// PDFs are shown as page images, not in the browser's PDF viewer: on the kiosk there must be
// nothing to zoom, download or change, only the pages to scroll and a button to print them.

import { API_URL, PDF_API_URL, PRINT_API_URL, PRINT_STREAM_API_URL } from '../api.config';

/** The progress of a print, as the backend reports it sheet by sheet (POST /api/print/stream). */
export type PrintEvent =
  | { type: 'prepared'; total: number }
  | { type: 'page'; page: number; total: number }
  | { type: 'done'; total: number }
  | { type: 'error'; message: string; page: number }
  // A backend without the stream: the pages are printed in one go, with no news until the end.
  | { type: 'unknown' };

/** A print that stopped: at the sheet page (1 = the first of the pages sent), if known. */
export class PrintStopped extends Error {
  constructor(message: string, readonly page: number | null) {
    super(message);
  }
}

// About 180 dpi (PDF units are 1/72 inch): sharp on screen and good enough on paper.
const SCALE = 2.5;

export function isPdf(url: string): boolean {
  try {
    return new URL(url, location.href).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

// pdf.js runs its parser here, not in a separate worker: when globalThis.pdfjsWorker is set it
// uses it directly, so no worker file has to be served. The forms are a few pages each.
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    // @ts-expect-error: the worker module has no type declarations.
    import('pdfjs-dist/build/pdf.worker.min.mjs')
  ]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  return pdfjs;
}

/** The pages of the PDF at url as image URLs (to release with releasePages). */
export async function renderPdf(url: string): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  // Other sites do not let the browser read their files: the backend downloads them for us.
  const own = url.startsWith(location.origin + '/') || url.startsWith(API_URL + '/');
  const response = await fetch(own ? url : `${PDF_API_URL}?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) pages.push(URL.createObjectURL(blob));
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

export function releasePages(pages: string[]): void {
  pages.forEach((page) => URL.revokeObjectURL(page));
}

/**
 * Prints the pages, one per sheet, on the kiosk's Bluetooth printer: the backend sends them to
 * it directly, without any print dialog. Rejects when the printer cannot be reached.
 */
export async function printPages(pages: string[]): Promise<void> {
  const images = await Promise.all(pages.map((page) => (page.startsWith('data:') ? page : dataUrl(page))));
  const response = await fetch(PRINT_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages: images })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Prints the pages, one per sheet, and reports each sheet as the printer gets it. With a backend
 * that cannot report the progress, prints them as printPages does, after an "unknown" event.
 * Rejects with PrintStopped, saying at which sheet when it is known.
 */
export async function printPagesWithProgress(pages: string[], onEvent: (event: PrintEvent) => void): Promise<void> {
  const images = await Promise.all(pages.map((page) => (page.startsWith('data:') ? page : dataUrl(page))));
  const response = await fetch(PRINT_STREAM_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages: images })
  });
  if (response.status === 404 || response.status === 405) {
    onEvent({ type: 'unknown' });
    try {
      await printPages(images);
    } catch (err) {
      throw new PrintStopped(String(err), null);
    }
    return;
  }
  if (!response.ok || !response.body) throw new PrintStopped(`HTTP ${response.status}`, null);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let printed = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as PrintEvent;
      onEvent(event);
      if (event.type === 'page') printed = event.page;
      if (event.type === 'error') throw new PrintStopped(event.message, event.page);
      if (event.type === 'done') return;
    }
  }
  // The stream ended without "done": the backend stopped, after the sheets it reported.
  throw new PrintStopped('Stampa interrotta', Math.min(printed + 1, pages.length));
}
