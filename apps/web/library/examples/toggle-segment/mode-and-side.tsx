import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";

const MODES = [
	{ mode: "2-up", labelKey: "viewer.visualDiff.twoUp" },
	{ mode: "swipe", labelKey: "viewer.visualDiff.swipe" },
	{ mode: "onion", labelKey: "viewer.visualDiff.onionSkin" },
] as const;

export default function ModeAndSide() {
	const t = useT();
	const [mode, setMode] = useState<string>("swipe");
	const [side, setSide] = useState<"base" | "worktree">("worktree");
	return (
		<div className="flex w-full flex-wrap items-center gap-4">
			<div className="flex items-center gap-2">
				{MODES.map((candidate) => (
					<ToggleSegment
						key={candidate.mode}
						testid={`image-diff-${candidate.mode}`}
						label={t(candidate.labelKey)}
						active={mode === candidate.mode}
						onClick={() => setMode(candidate.mode)}
					/>
				))}
			</div>
			{mode !== "2-up" ? (
				<div className="ml-auto flex items-center gap-2">
					<ToggleSegment
						testid="image-diff-side-base"
						label={t("viewer.visualDiff.commentOnOld")}
						active={side === "base"}
						onClick={() => setSide("base")}
					/>
					<ToggleSegment
						testid="image-diff-side-worktree"
						label={t("viewer.visualDiff.commentOnNew")}
						active={side === "worktree"}
						onClick={() => setSide("worktree")}
					/>
				</div>
			) : null}
		</div>
	);
}
