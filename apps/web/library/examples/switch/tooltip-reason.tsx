import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useState } from "react";

export default function TooltipReason() {
	const t = useT();
	const [loaded, setLoaded] = useState(true);
	const hint = loaded ? t("chat.skills.switchOn") : t("chat.skills.switchOff");
	const blocked = t("chat.skills.blockedByTrust");
	return (
		<div className="flex items-center gap-16">
			<IconTooltip label={hint}>
				<Switch
					checked={loaded}
					label={t("chat.skills.enableSkill", { skill: "write-spec" })}
					aria-description={hint}
					onCheckedChange={setLoaded}
				/>
			</IconTooltip>
			<IconTooltip label={blocked} wrapTrigger>
				<Switch
					checked={false}
					disabled
					label={t("chat.skills.enableSkill", { skill: "deploy" })}
					aria-description={blocked}
					onCheckedChange={() => {}}
				/>
			</IconTooltip>
		</div>
	);
}
