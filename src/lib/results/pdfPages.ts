import { cropRect } from "./keyCrop";
import type { FigureBox } from "./questionRow";

// pdf.js is loaded on first use so the editor stays light for papers without pictures.
type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;

const docs = new Map<string, Promise<PdfDoc>>();
const pages = new Map<string, Promise<HTMLCanvasElement>>();
const TARGET_WIDTH = 1400;

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

/** Renders a page once per paper; later crops reuse the same canvas. */
export function renderPage(cacheId: string, url: string, pageNumber: number): Promise<HTMLCanvasElement> {
  const key = `${cacheId}#${pageNumber}`;
  let p = pages.get(key);
  if (!p) {
    p = (async () => {
      const doc = await loadDoc(cacheId, url);
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
      return canvas;
    })();
    p.catch(() => pages.delete(key));
    pages.set(key, p);
  }
  return p;
}

/** A new canvas holding just the figure box (plus padding) of a rendered page. */
export async function cropFigure(cacheId: string, url: string, pageNumber: number, box: FigureBox): Promise<HTMLCanvasElement> {
  const page = await renderPage(cacheId, url, pageNumber);
  const { sx, sy, sw, sh } = cropRect(box, page.width, page.height);
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d")!.drawImage(page, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

export function clearPageCache(cacheId: string) {
  for (const k of [...docs.keys()]) if (k === cacheId) docs.delete(k);
  for (const k of [...pages.keys()]) if (k.startsWith(`${cacheId}#`)) pages.delete(k);
}
