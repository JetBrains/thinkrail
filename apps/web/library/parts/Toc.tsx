import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";

export interface TocEntry {
	id: string;
	title: string;
	children?: readonly TocEntry[];
}

function flatten(entries: readonly TocEntry[]): string[] {
	return entries.flatMap((entry) => [entry.id, ...flatten(entry.children ?? [])]);
}

export function Toc({ entries }: { entries: readonly TocEntry[] }) {
	const [active, setActive] = useState<string | null>(entries[0]?.id ?? null);
	useEffect(() => {
		const root = document.getElementById("library-main");
		if (!root) return;
		const ids = flatten(entries);
		const update = () => {
			const top = root.getBoundingClientRect().top + 24;
			let current = ids[0] ?? null;
			for (const id of ids) {
				const element = document.getElementById(id);
				if (element && element.getBoundingClientRect().top <= top) current = id;
			}
			setActive(current);
		};
		update();
		root.addEventListener("scroll", update, { passive: true });
		return () => root.removeEventListener("scroll", update);
	}, [entries]);
	const link = (entry: TocEntry, nested: boolean) => (
		<a
			href={`#${entry.id}`}
			onClick={(event) => {
				event.preventDefault();
				document.getElementById(entry.id)?.scrollIntoView({ block: "start" });
			}}
			aria-current={active === entry.id ? "location" : undefined}
			className={cn(
				"-ml-px block truncate border-l-2 py-2 tr-text-metadata outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
				nested ? "pl-24" : "pl-12",
				active === entry.id
					? "border-primary text-primary"
					: "border-transparent text-text-muted hover:text-text-default",
			)}
		>
			{entry.title}
		</a>
	);
	return (
		<nav aria-label="On this page" className="flex flex-col border-border-default border-l">
			{entries.map((entry) => (
				<div key={entry.id} className="flex flex-col">
					{link(entry, false)}
					{entry.children?.map((child) => (
						<div key={child.id}>{link(child, true)}</div>
					))}
				</div>
			))}
		</nav>
	);
}
