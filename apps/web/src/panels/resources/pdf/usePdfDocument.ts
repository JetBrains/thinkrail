import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import type { ResourceContent } from "@/resources";
import { contentStamp } from "../reviewComposerState";
import { loadPdfDocument } from "./pdfLoader";

interface PdfDocumentState {
	identity: string;
	document: PDFDocumentProxy | null;
	error: boolean;
	settled: boolean;
}

export function pdfContentIdentity(content: ResourceContent): string {
	return content.kind === "bytes"
		? JSON.stringify([contentStamp(content), content.url])
		: contentStamp(content);
}

export function usePdfDocument(content: ResourceContent): PdfDocumentState {
	const identity = pdfContentIdentity(content);
	const contentRef = useRef(content);
	contentRef.current = content;
	const [state, setState] = useState<PdfDocumentState>({
		identity,
		document: null,
		error: false,
		settled: false,
	});
	const current =
		state.identity === identity
			? state
			: { identity, document: null, error: false, settled: false };

	useEffect(() => {
		const controller = new AbortController();
		let loaded: PDFDocumentProxy | null = null;
		setState({ identity, document: null, error: false, settled: false });
		void loadPdfDocument(contentRef.current, controller.signal).then(
			(document) => {
				if (controller.signal.aborted) {
					void document?.destroy();
					return;
				}
				loaded = document;
				setState({ identity, document, error: false, settled: true });
			},
			() => {
				if (!controller.signal.aborted) {
					setState({ identity, document: null, error: true, settled: true });
				}
			},
		);
		return () => {
			controller.abort();
			void loaded?.destroy();
		};
	}, [identity]);

	return current;
}
