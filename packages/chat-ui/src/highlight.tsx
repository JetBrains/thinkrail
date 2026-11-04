import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useId,
	useState,
	useSyncExternalStore,
} from "react";

/** The host's syntax highlighter: a synchronous cache read and a keyed request; `null` means show plain text. */
export interface CodeHighlighter {
	cached(code: string, lang: string): string | null;
	highlight(code: string, lang: string, key: string): Promise<string | null>;
}

const NO_HIGHLIGHT: CodeHighlighter = {
	cached: () => null,
	highlight: () => Promise.resolve(null),
};

const HighlighterContext = createContext<CodeHighlighter>(NO_HIGHLIGHT);

export function CodeHighlighterProvider({
	highlighter,
	children,
}: {
	highlighter: CodeHighlighter;
	children: ReactNode;
}) {
	return <HighlighterContext.Provider value={highlighter}>{children}</HighlighterContext.Provider>;
}

const PRE_END = "</code></pre>";

export interface ShownHighlight {
	seq: number;
	code: string;
	lang: string;
	html: string;
}

export function newerHighlight(shown: ShownHighlight | null, next: ShownHighlight) {
	return shown && shown.seq > next.seq ? shown : next;
}

export function staleHighlight(code: string, lang: string, latest: ShownHighlight | null) {
	if (!latest || latest.lang !== lang || !code.startsWith(latest.code)) return null;
	const tail = code.slice(latest.code.length);
	if (!tail) return latest.html;
	if (!latest.html.endsWith(PRE_END)) return null;
	const escaped = tail.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return latest.html.slice(0, -PRE_END.length) + escaped + PRE_END;
}

let highlightSeq = 0;
function nextHighlightSeq() {
	highlightSeq += 1;
	return highlightSeq;
}

function subscribeNever() {
	return () => {};
}

export function useHighlightedCode(code: string, lang: string): string | null {
	const key = useId();
	const highlighter = useContext(HighlighterContext);
	const cached = useSyncExternalStore(
		subscribeNever,
		() => highlighter.cached(code, lang),
		() => null,
	);
	const [latest, setLatest] = useState<ShownHighlight | null>(null);

	useEffect(() => {
		const seq = nextHighlightSeq();
		void highlighter.highlight(code, lang, key).then((html) => {
			if (html !== null) setLatest((shown) => newerHighlight(shown, { seq, code, lang, html }));
		});
	}, [highlighter, code, lang, key]);

	return cached ?? staleHighlight(code, lang, latest);
}
