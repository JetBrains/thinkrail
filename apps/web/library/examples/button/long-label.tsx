import { RiGitCommitLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";

export default function LongLabel() {
	const t = useT();
	return (
		<div className="flex flex-col items-start gap-8">
			<Button variant="outline" size="m" iconLeft={RiGitCommitLine}>
				{t("plan.revisions.openCommit")}
			</Button>
			<div className="w-full max-w-[26rem]">
				<Button variant="primary" className="w-full">
					{t("plan.revisions.openCommit")}
				</Button>
			</div>
		</div>
	);
}
