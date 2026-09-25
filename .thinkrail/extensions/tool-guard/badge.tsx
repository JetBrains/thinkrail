import { openSurface, remixicon } from "@thinkrail/ext/view";
import { useLog } from "./hooks";
import { EXT_NAME } from "./model";

const { RiShieldCheckLine } = remixicon;

const Badge = () => {
	const blocked = useLog().filter((decision) => decision.verdict === "block").length;
	if (blocked === 0) return null;
	return (
		<button
			type="button"
			data-testid="tool-guard-status"
			title="Open Tool guard"
			onClick={() => openSurface(EXT_NAME, "guard")}
			className="flex items-center gap-4 rounded-sm px-4 tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
		>
			<RiShieldCheckLine className="size-14 text-feedback-warning" />
			<span className="tabular-nums">{blocked} blocked</span>
		</button>
	);
};

export default Badge;
