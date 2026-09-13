import { RiArrowRightSLine as ChevronRight } from "@remixicon/react";
import type { ReactNode } from "react";
import { cn } from "@/lib";
import { useFold } from "./foldState";
import type { ReviewPackageItem } from "./reviewPackage";

function keyPackageItems(items: ReviewPackageItem[]): { key: string; item: ReviewPackageItem }[] {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const base = `${item.lineRef}·${item.body}`;
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		return { key: `${base}·${n}`, item };
	});
}

function PackageCommentRow({ foldId, item }: { foldId: string; item: ReviewPackageItem }) {
	const [expanded, toggle, toggleRef] = useFold(foldId);
	return (
		<li data-testid="review-package-item" data-chat-fold-root data-expanded={expanded}>
			<button
				ref={toggleRef}
				type="button"
				data-testid="review-package-item-toggle"
				aria-expanded={expanded}
				onClick={toggle}
				className="flex w-full cursor-pointer select-none items-start gap-4 rounded-[var(--radius-sm)] px-4 py-4 text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
			>
				<ChevronRight
					className={cn(
						"mt-2 size-16 shrink-0 text-text-subtle transition-transform",
						expanded && "rotate-90",
					)}
				/>
				{item.lineRef && (
					<span className="shrink-0 tr-code-text text-text-subtle">{item.lineRef}</span>
				)}
				<span
					className={cn(
						"min-w-0 flex-1 text-text-default",
						expanded ? "whitespace-pre-wrap" : "truncate",
					)}
				>
					{item.body}
				</span>
			</button>
			{expanded && item.fragment && (
				<pre className="mb-4 ml-16 max-h-128 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border border-border-muted bg-sunken px-8 py-4 tr-code-text text-text-muted">
					{item.fragment}
				</pre>
			)}
		</li>
	);
}

export function ReviewPackageComments({
	foldPrefix,
	items,
}: {
	foldPrefix: string;
	items: ReviewPackageItem[];
}): ReactNode {
	if (items.length === 0) return null;
	return (
		<ul className="mt-4 flex flex-col">
			{keyPackageItems(items).map(({ key, item }) => (
				<PackageCommentRow key={key} foldId={`${foldPrefix}:${key}`} item={item} />
			))}
		</ul>
	);
}
