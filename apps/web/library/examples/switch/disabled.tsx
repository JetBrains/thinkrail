import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";

export default function Disabled() {
	const t = useT();
	return (
		<div className="flex items-center gap-16">
			<Switch
				checked={false}
				disabled
				label={t("settings.notifications.enable")}
				onCheckedChange={() => {}}
			/>
			<Switch
				checked
				disabled
				label={t("settings.notifications.enable")}
				onCheckedChange={() => {}}
			/>
		</div>
	);
}
