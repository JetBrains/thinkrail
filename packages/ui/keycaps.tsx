import { cn } from "./utils";

function keyedCaps(keys: readonly string[]): { id: string; key: string }[] {
	return keys.map((key, index) => ({
		id: `${key}:${keys.slice(0, index).filter((earlier) => earlier === key).length}`,
		key,
	}));
}

export function Keycaps({ keys, className }: { keys: readonly string[]; className?: string }) {
	return (
		<span className={cn("flex shrink-0 items-center gap-2", className)}>
			{keyedCaps(keys).map(({ id, key }) => (
				<kbd
					key={id}
					className="inline-flex h-16 min-w-16 items-center justify-center rounded-xs border border-border-default px-4 tr-text-metadata text-text-muted"
				>
					{key}
				</kbd>
			))}
		</span>
	);
}
