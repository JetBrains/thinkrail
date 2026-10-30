import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useState } from "react";

export default function DisabledControl() {
	const t = useT();
	const [checked, setChecked] = useState(true);
	const hint = checked ? t("chat.skills.switchOn") : t("chat.skills.switchOff");
	const blocked = t("chat.skills.blockedByTrust");
	return (
		<div className="flex items-center gap-24">
			<IconTooltip label={hint}>
				<Switch
					checked={checked}
					label="code-review"
					aria-description={hint}
					onCheckedChange={setChecked}
				/>
			</IconTooltip>
			<IconTooltip label={blocked} wrapTrigger>
				<Switch
					checked={false}
					disabled
					label="release-notes"
					aria-description={blocked}
					onCheckedChange={() => {}}
				/>
			</IconTooltip>
		</div>
	);
}
