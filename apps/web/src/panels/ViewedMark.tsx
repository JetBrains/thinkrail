import { RiCheckLine as Check } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";

export function ViewedMark() {
	const t = useT();
	return (
		<span
			data-testid="change-viewed"
			role="img"
			aria-label={t("panels.viewedMark.label")}
			title={t("panels.viewedMark.label")}
			className="flex size-14 shrink-0 items-center justify-center rounded-xs bg-primary text-text-on-primary"
		>
			<Check className="size-10" />
		</span>
	);
}
