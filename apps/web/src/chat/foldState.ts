import {
	createContext,
	createElement,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

const foldState = new Map<string, boolean>();
const foldExpanders = new Map<string, Set<() => void>>();
const noop = () => undefined;

export function foldOverride(id: string): boolean | undefined {
	return foldState.get(id);
}

/** Opens these folds, mounted or not, as a reveal does before it lands inside them. */
export function expandFolds(ids: readonly string[]): void {
	for (const id of ids) {
		foldState.set(id, true);
		for (const expand of foldExpanders.get(id) ?? []) expand();
	}
}

export type FoldAnchorResolver = () => HTMLElement | null;
type FoldChangeCompletion = () => void;
type PrepareFoldChange = (
	resolveAnchor: FoldAnchorResolver,
	provenance?: "user" | "automatic",
) => FoldChangeCompletion;
type FoldAnchorRef = (element: HTMLElement | null) => void;
type FoldToggle = (event?: ReactMouseEvent<HTMLElement>) => void;

const FoldGeometryContext = createContext<PrepareFoldChange>(() => noop);

export function FoldGeometryProvider({
	onBeforeChange,
	children,
}: {
	onBeforeChange: PrepareFoldChange;
	children: ReactNode;
}) {
	return createElement(FoldGeometryContext.Provider, { value: onBeforeChange }, children);
}

export function useFoldGeometry(): PrepareFoldChange {
	return useContext(FoldGeometryContext);
}

export function useFoldAnchor(id: string): [FoldAnchorResolver, FoldAnchorRef] {
	const anchor = useRef<HTMLElement | null>(null);
	const chatRoot = useRef<HTMLElement | null>(null);
	const resolveAnchor = useCallback(() => {
		if (anchor.current?.isConnected) return anchor.current;
		return (
			Array.from(
				chatRoot.current?.querySelectorAll<HTMLElement>("[data-chat-fold-anchor]") ?? [],
			).find((element) => element.dataset.chatFoldAnchor === id) ?? null
		);
	}, [id]);
	const anchorRef = useCallback<FoldAnchorRef>(
		(element) => {
			anchor.current = element;
			if (!element) return;
			element.dataset.chatFoldAnchor = id;
			chatRoot.current = element.closest<HTMLElement>("[data-testid=chat-scroll]");
		},
		[id],
	);
	return [resolveAnchor, anchorRef];
}

export function useFold(id: string, fallback = false): [boolean, FoldToggle, FoldAnchorRef] {
	const prepareChange = useFoldGeometry();
	const completeChange = useRef<FoldChangeCompletion>(noop);
	const [resolveAnchor, anchorRef] = useFoldAnchor(id);
	const [override, setOverride] = useState<boolean | undefined>(() => foldState.get(id));
	const [fallbackExpanded, setFallbackExpanded] = useState(fallback);
	const expanded = override ?? fallbackExpanded;
	useLayoutEffect(() => {
		if (fallback === fallbackExpanded) return;
		if (override === undefined && resolveAnchor()) {
			completeChange.current = prepareChange(resolveAnchor);
		}
		setFallbackExpanded(fallback);
	}, [fallback, fallbackExpanded, override, prepareChange, resolveAnchor]);
	useLayoutEffect(() => {
		const complete = completeChange.current;
		completeChange.current = noop;
		complete();
	}, [expanded]);
	useEffect(() => {
		const expand = () => setOverride(true);
		const expanders = foldExpanders.get(id) ?? new Set<() => void>();
		expanders.add(expand);
		foldExpanders.set(id, expanders);
		return () => {
			expanders.delete(expand);
			if (expanders.size === 0 && foldExpanders.get(id) === expanders) foldExpanders.delete(id);
		};
	}, [id]);
	const toggle: FoldToggle = (event) => {
		if (event) completeChange.current = prepareChange(resolveAnchor, "user");
		const next = !expanded;
		foldState.set(id, next);
		setOverride(next);
	};
	return [expanded, toggle, anchorRef];
}

const selectionState = new Map<string, string | null>();

export function useSelection(
	id: string,
): [string | null, (key: string, event?: ReactMouseEvent<HTMLElement>) => void] {
	const prepareChange = useFoldGeometry();
	const completeChange = useRef<FoldChangeCompletion>(noop);
	const [selected, setSelected] = useState<string | null>(() => selectionState.get(id) ?? null);
	useLayoutEffect(() => {
		const complete = completeChange.current;
		completeChange.current = noop;
		complete();
	}, [selected]);
	const select = (key: string, event?: ReactMouseEvent<HTMLElement>) => {
		if (event) {
			const anchor = event.currentTarget;
			completeChange.current = prepareChange(() => anchor, "user");
		}
		const next = selected === key ? null : key;
		selectionState.set(id, next);
		setSelected(next);
	};
	return [selected, select];
}
