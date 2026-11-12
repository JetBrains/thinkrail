import { useScrollViewState, viewStateScrollTop } from "@thinkrail/resource-renderers";
import { type ReactNode, useEffect, useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { type FilesScrollView, selectFilesTreeView, useAppStore } from "../store";

const SAVE_DELAY_MS = 200;

export function RememberedScrollArea({
	workspaceId,
	view,
	scope = "",
	restore = true,
	className,
	viewportClassName,
	children,
}: {
	workspaceId: string;
	view: FilesScrollView;
	scope?: string;
	restore?: boolean;
	className?: string;
	viewportClassName?: string;
	children: ReactNode;
}) {
	const [initial] = useState(() => {
		if (!restore) return null;
		const saved = selectFilesTreeView(useAppStore.getState(), workspaceId).scroll[view];
		return saved && saved.scope === scope ? { scrollTop: saved.top } : null;
	});
	const { elementRef, attach } = useScrollViewState<HTMLDivElement>(initial, (state) => {
		const top = viewStateScrollTop(state);
		if (top !== null) useAppStore.getState().setFilesTreeScroll(workspaceId, view, top, scope);
	});

	useEffect(() => {
		const node = elementRef.current;
		if (!node) return;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const onScroll = () => {
			if (timer !== null) return;
			timer = setTimeout(() => {
				timer = null;
				useAppStore.getState().setFilesTreeScroll(workspaceId, view, node.scrollTop, scope);
			}, SAVE_DELAY_MS);
		};
		node.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			node.removeEventListener("scroll", onScroll);
			if (timer !== null) clearTimeout(timer);
		};
	}, [elementRef, workspaceId, view, scope]);

	return (
		<QuietScrollArea
			className={className}
			viewportClassName={viewportClassName}
			viewportRef={attach}
		>
			{children}
		</QuietScrollArea>
	);
}
