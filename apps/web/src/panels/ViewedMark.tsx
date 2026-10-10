import { RiCheckLine as Check } from "@remixicon/react";

export function ViewedMark() {
	return (
		<span
			data-testid="change-viewed"
			role="img"
			aria-label="Viewed"
			title="Viewed"
			className="flex size-14 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-primary text-text-on-primary"
		>
			<Check className="size-10" />
		</span>
	);
}
