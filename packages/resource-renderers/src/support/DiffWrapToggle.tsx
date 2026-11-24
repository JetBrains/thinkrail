import { RiTextWrap } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useResourcePreferences } from "../host";

export function DiffWrapToggle() {
	const t = useT();
	const { diffWrapLines, setDiffWrapLines } = useResourcePreferences();
	return (
		<IconButton
			icon={RiTextWrap}
			label={t("viewer.code.wrapLines")}
			variant="ghost"
			size="m"
			tabIndex={0}
			selected={diffWrapLines}
			data-testid="diff-toggle-wrap"
			aria-pressed={diffWrapLines}
			onClick={() => setDiffWrapLines(!diffWrapLines)}
		/>
	);
}
