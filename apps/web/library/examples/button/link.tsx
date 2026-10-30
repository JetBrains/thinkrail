import { useT } from "@thinkrail/locales/react";
import { buttonDataAttributes, buttonVariants } from "@thinkrail/ui/button";

export default function Link() {
	const t = useT();
	return (
		<a
			href="#/icon-button"
			{...buttonDataAttributes({ variant: "outline", size: "m" })}
			className={buttonVariants({ variant: "outline", size: "m" })}
		>
			{t("common.next")}
		</a>
	);
}
