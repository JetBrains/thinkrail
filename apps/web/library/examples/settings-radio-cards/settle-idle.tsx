import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRadioCards } from "@/panels/SettingsRadioCards";

type IdleChoice = `${number}` | "never";

const IDLE_CHOICES: readonly {
	id: IdleChoice;
	days: number | null;
	hint?: MessageKey;
	description: MessageKey;
	testId: string;
}[] = [
	{ id: "1", days: 1, description: "settings.workspaces.idle.oneDay", testId: "settle-idle-1" },
	{ id: "3", days: 3, description: "settings.workspaces.idle.threeDays", testId: "settle-idle-3" },
	{
		id: "7",
		days: 7,
		hint: "settings.workspaces.idle.defaultHint",
		description: "settings.workspaces.idle.sevenDays",
		testId: "settle-idle-7",
	},
	{
		id: "14",
		days: 14,
		description: "settings.workspaces.idle.fourteenDays",
		testId: "settle-idle-14",
	},
	{
		id: "never",
		days: null,
		description: "settings.workspaces.idle.never",
		testId: "settle-idle-never",
	},
];

export default function SettleIdle() {
	const t = useT();
	const [choice, setChoice] = useState<IdleChoice>("7");
	return (
		<div className="w-full">
			<SettingsRadioCards
				name="settle-idle-days"
				label={t("settings.workspaces.title")}
				choices={IDLE_CHOICES.map(({ days, hint, description, ...rest }) => ({
					...rest,
					label:
						days === null
							? t("settings.workspaces.idle.neverLabel")
							: t("settings.workspaces.idle.days", { count: days }),
					...(hint ? { hint: t(hint) } : {}),
					description: t(description),
				}))}
				value={choice}
				onSelect={setChoice}
			/>
		</div>
	);
}
