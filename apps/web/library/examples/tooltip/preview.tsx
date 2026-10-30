import { RiExternalLinkLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { buttonDataAttributes, buttonVariants } from "@thinkrail/ui/button";
import { IconTooltip } from "@thinkrail/ui/tooltip";

export default function Preview() {
	const t = useT();
	const label = t("shell.location.review.openLink", { label: "PR #951" });
	return (
		<IconTooltip label={label}>
			<a
				href="#/tooltip"
				aria-label={label}
				{...buttonDataAttributes({ variant: "ghost", size: "m", iconOnly: true })}
				className={buttonVariants({ variant: "ghost", size: "m", shape: "icon" })}
			>
				<RiExternalLinkLine aria-hidden />
			</a>
		</IconTooltip>
	);
}
