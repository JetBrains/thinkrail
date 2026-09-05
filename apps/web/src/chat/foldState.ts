import {
	createContext,
	createElement,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

const foldState = new Map<string, boolean>();
const noop = () => undefined;

export type FoldAnchorResolver = () => HTMLElement | null;
type FoldChangeCompletion = () => void;
type PrepareFoldChange = (resolveAnchor: FoldAnchorResolver) => FoldChangeCompletion;
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
	const toggle: FoldToggle = (event) => {
		if (event) completeChange.current = prepareChange(resolveAnchor);
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
			completeChange.current = prepareChange(() => anchor);
		}
		const next = selected === key ? null : key;
		selectionState.set(id, next);
		setSelected(next);
	};
	return [selected, select];
}
