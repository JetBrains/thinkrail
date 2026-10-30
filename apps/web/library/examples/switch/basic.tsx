import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";
import { useState } from "react";

export default function Basic() {
	const t = useT();
	const [setup, setSetup] = useState(true);
	return (
		<div className="flex items-center gap-12">
			<span className="tr-text-ui text-text-default">{t("panels.createProject.setupTitle")}</span>
			<Switch
				checked={setup}
				label={t("panels.createProject.setupTitle")}
				onCheckedChange={setSetup}
			/>
		</div>
	);
}
