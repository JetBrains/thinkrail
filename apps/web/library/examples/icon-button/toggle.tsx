import { RiParagraph } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useState } from "react";

export default function Toggle() {
	const t = useT();
	const [hidden, setHidden] = useState(false);
	return (
		<IconButton
			icon={RiParagraph}
			label={t("panels.diffPane.hideWhitespace")}
			selected={hidden}
			aria-pressed={hidden}
			onClick={() => setHidden((value) => !value)}
		/>
	);
}
