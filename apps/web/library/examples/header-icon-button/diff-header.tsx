import { RiArrowGoBackLine, RiFileCopyLine, RiParagraph } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { HeaderIconButton } from "@/panels/HeaderIconButton";

export default function DiffHeader() {
	const t = useT();
	const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
	return (
		<div
			role="toolbar"
			aria-label={t("panels.diffPane.viewMode")}
			className="flex items-center gap-4"
		>
			<HeaderIconButton
				testid="diff-revert-file"
				label={t("panels.diffPane.revertFile")}
				onClick={() => {}}
				icon={RiArrowGoBackLine}
			/>
			<HeaderIconButton
				testid="diff-toggle-whitespace"
				label={t("panels.diffPane.hideWhitespace")}
				active={ignoreWhitespace}
				onClick={() => setIgnoreWhitespace(!ignoreWhitespace)}
				icon={RiParagraph}
			/>
			<HeaderIconButton
				testid="diff-copy"
				label={t("panels.diffPane.copyContents")}
				onClick={() => {}}
				icon={RiFileCopyLine}
			/>
		</div>
	);
}
