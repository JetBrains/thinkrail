import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";
import { useState } from "react";

export default function DialogOption() {
	const t = useT();
	const [setup, setSetup] = useState(true);
	return (
		<div className="flex w-full max-w-[28rem] items-center gap-12">
			<span className="min-w-0 flex-1">
				<span className="block tr-title-compact text-text-default">
					{t("panels.createProject.setupTitle")}
				</span>
				<span className="block tr-text-metadata text-text-muted">
					{t("panels.createProject.setupDetail")}
				</span>
			</span>
			<Switch
				checked={setup}
				onCheckedChange={setSetup}
				label={t("panels.createProject.setupTitle")}
				testId="create-project-setup"
			/>
		</div>
	);
}
