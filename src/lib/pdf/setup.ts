import { GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let configured = false;

export function setupPdfWorker(): void {
  if (configured) return;
  GlobalWorkerOptions.workerSrc = pdfWorker;
  configured = true;
}
