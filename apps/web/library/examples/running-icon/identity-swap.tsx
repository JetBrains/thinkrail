import { RiGitBranchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { RunningIcon } from "@/components/RunningIcon";

export default function IdentitySwap() {
	const t = useT();
	const [running, setRunning] = useState(true);
	return (
		<div className="flex w-full max-w-xs flex-col gap-12">
			<button type="button" className="flex min-w-0 items-center gap-4 text-left">
				{running ? (
					<RunningIcon className="size-14 text-primary" />
				) : (
					<RiGitBranchLine className="size-14 shrink-0 text-primary" />
				)}
				<span className="truncate tr-text-ui text-primary">fix-login</span>
			</button>
			<div>
				<Button variant="outline" size="m" onClick={() => setRunning((value) => !value)}>
					{running ? t("chat.composer.stop") : t("chat.composer.send")}
				</Button>
			</div>
		</div>
	);
}
