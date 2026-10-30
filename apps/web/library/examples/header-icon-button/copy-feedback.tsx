import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { withIconClass } from "@thinkrail/ui/button";
import { useState } from "react";
import { HeaderIconButton } from "@/panels/HeaderIconButton";

const CopiedCheck = withIconClass(RiCheckLine, "text-feedback-success");

export default function CopyFeedback() {
	const t = useT();
	const [copied, setCopied] = useState(false);
	const copy = () => {
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	return (
		<HeaderIconButton
			testid="diff-copy"
			label={t("panels.diffPane.copyContents")}
			onClick={copy}
			icon={copied ? CopiedCheck : RiFileCopyLine}
		/>
	);
}
