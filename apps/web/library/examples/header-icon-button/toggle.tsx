import { RiParagraph } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { HeaderIconButton } from "@/panels/HeaderIconButton";

export default function Toggle() {
	const t = useT();
	const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
	return (
		<HeaderIconButton
			testid="changes-review-toggle-whitespace"
			label={t("changes.review.hideWhitespace")}
			active={ignoreWhitespace}
			onClick={() => setIgnoreWhitespace(!ignoreWhitespace)}
			icon={RiParagraph}
		/>
	);
}
