import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ResourceContent } from "@/resources";
import { pdfSourceUrl } from "./pdfModel";

let pdfModulePromise: Promise<typeof import("pdfjs-dist")> | null = null;

export async function loadPdfModule(): Promise<typeof import("pdfjs-dist")> {
	pdfModulePromise ??= import("pdfjs-dist").then((pdfjs) => {
		pdfjs.GlobalWorkerOptions.workerSrc = new URL(
			"pdfjs-dist/build/pdf.worker.min.mjs",
			import.meta.url,
		).toString();
		return pdfjs;
	});
	return pdfModulePromise;
}

export async function loadPdfDocument(
	content: ResourceContent,
	signal: AbortSignal,
): Promise<PDFDocumentProxy | null> {
	if (content.kind !== "bytes") return null;
	const response = await fetch(pdfSourceUrl(content.url, content.hash), { signal });
	if (!response.ok) throw new Error(`PDF fetch failed (${response.status})`);
	const data = new Uint8Array(await response.arrayBuffer());
	if (signal.aborted) return null;
	const pdfjs = await loadPdfModule();
	if (signal.aborted) return null;
	return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}

interface PendingPdfRender {
	start(): void;
	cancel(): void;
}

export class PdfRenderQueue {
	private active = 0;
	private readonly pending: PendingPdfRender[] = [];

	constructor(private readonly limit = 2) {}

	run<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			let started = false;
			let cancelled = false;
			const onAbort = () => entry.cancel();
			const entry: PendingPdfRender = {
				start: () => {
					if (cancelled) return;
					started = true;
					signal?.removeEventListener("abort", onAbort);
					this.active += 1;
					job()
						.then(resolve, reject)
						.finally(() => {
							this.active -= 1;
							this.drain();
						});
				},
				cancel: () => {
					if (started || cancelled) return;
					cancelled = true;
					signal?.removeEventListener("abort", onAbort);
					const index = this.pending.indexOf(entry);
					if (index >= 0) this.pending.splice(index, 1);
					reject(new Error("PDF render cancelled"));
					this.drain();
				},
			};
			if (signal?.aborted) entry.cancel();
			else {
				signal?.addEventListener("abort", onAbort, { once: true });
				this.pending.push(entry);
				this.drain();
			}
		});
	}

	private drain(): void {
		while (this.active < this.limit) {
			const entry = this.pending.shift();
			if (!entry) return;
			entry.start();
		}
	}
}
