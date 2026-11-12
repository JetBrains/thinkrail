import { type ReactNode, useMemo, useState } from "react";
import type { ResourceDiffProps, ResourceRenderer } from "../registry";
import { ExpensiveDiffNotice } from "./ExpensiveDiffNotice";
import { isDiffTooExpensive, VIRTUALIZED_DIFF_LINES } from "./largeDiff";
import { RendererDiff } from "./rendererMount";

export function GuardedRendererDiff({
	lineCount,
	noticeActions,
	...props
}: Omit<ResourceDiffProps, "virtualize"> & {
	renderer: ResourceRenderer;
	implementationKey: string;
	lineCount: number;
	noticeActions?: ReactNode;
}) {
	const { original, modified } = props;
	const tooExpensive = useMemo(() => isDiffTooExpensive(original, modified), [original, modified]);
	const [showAnyway, setShowAnyway] = useState(false);
	if (tooExpensive && !showAnyway) {
		return <ExpensiveDiffNotice onShowAnyway={() => setShowAnyway(true)} actions={noticeActions} />;
	}
	return (
		<RendererDiff
			key={props.implementationKey}
			{...props}
			virtualize={lineCount > VIRTUALIZED_DIFF_LINES}
		/>
	);
}
