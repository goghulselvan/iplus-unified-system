import { cropRect } from "./keyCrop";
import type { FigureBox } from "./questionRow";

// pdf.js is loaded on first use so the editor stays light for papers without pictures.
type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;
type PageImage = ImageBitmap | HTMLCanvasElement;

const docs = new Map<string, Promise<PdfDoc>>();
/** Rendered pages, least recently used first. Kept small: a full page is about 11 MB. */
const pages = new Map<string, Promise<PageImage>>();
const TARGET_WIDTH = 1400;
export const MAX_CACHED_PAGES = 6;

async function loadDoc(cacheId: string, url: string): Promise<PdfDoc> {
  let p = docs.get(cacheId);
  if (!p) {
    p = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs.getDocument({ url }).promise;
    })();
    p.catch(() => docs.delete(cacheId));
    docs.set(cacheId, p);
  }
  return p;
}

function release(img: PageImage) {
  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) img.close();
  else { const c = img as HTMLCanvasElement; c.width = 0; c.height = 0; }
}

function evictOverflow() {
  while (pages.size > MAX_CACHED_PAGES) {
    const oldest = pages.keys().next().value as string;
    const p = pages.get(oldest)!;
    pages.delete(oldest);
    p.then(release, () => {});
  }
}

/** Renders a page once; the last few pages stay cached, older ones are released. */
export function renderPage(cacheId: string, url: string, pageNumber: number): Promise<PageImage> {
  const key = `${cacheId}#${pageNumber}`;
  let p = pages.get(key);
  if (p) {
    // Mark as most recently used.
    pages.delete(key);
    pages.set(key, p);
    return p;
  }
  p = (async () => {
    const doc = await loadDoc(cacheId, url);
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    page.cleanup();
    if (typeof createImageBitmap === "function") {
      try {
        const bmp = await createImageBitmap(canvas);
        canvas.width = 0; canvas.height = 0;
        return bmp;
      } catch { /* keep the canvas */ }
    }
    return canvas;
  })();
  p.catch(() => pages.delete(key));
  pages.set(key, p);
  evictOverflow();
  return p;
}

/** A new canvas holding just the figure box (plus padding) of a rendered page. */
export async function cropFigure(cacheId: string, url: string, pageNumber: number, box: FigureBox): Promise<HTMLCanvasElement> {
  // A page can be released just after it resolves; render it again once if so.
  let page = await renderPage(cacheId, url, pageNumber);
  if (!page.width) page = await renderPage(cacheId, url, pageNumber);
  const { sx, sy, sw, sh } = cropRect(box, page.width, page.height);
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d")!.drawImage(page, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/** Releases the pdf.js document and every cached page of one paper. */
export function clearPageCache(cacheId: string) {
  const doc = docs.get(cacheId);
  docs.delete(cacheId);
  doc?.then((d) => d.destroy(), () => {});
  for (const k of [...pages.keys()]) {
    if (!k.startsWith(`${cacheId}#`)) continue;
    const p = pages.get(k)!;
    pages.delete(k);
    p.then(release, () => {});
  }
}
