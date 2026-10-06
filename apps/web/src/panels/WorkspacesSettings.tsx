import { WORKSPACE_SETTLE_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { toast, useAppStore } from "../store";
import { getTransport } from "../transport";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";

type IdleChoice = "1" | "3" | "7" | "14" | "never";

const IDLE_CHOICES: readonly SettingsRadioChoice<IdleChoice>[] = [
	{
		id: "1",
		label: "1 day",
		description: "Anything quiet overnight settles.",
		testId: "settle-idle-1",
	},
	{
		id: "3",
		label: "3 days",
		hint: "default",
		description: "A long weekend of silence parks a workspace.",
		testId: "settle-idle-3",
	},
	{
		id: "7",
		label: "7 days",
		description: "A week idle before it settles.",
		testId: "settle-idle-7",
	},
	{
		id: "14",
		label: "14 days",
		description: "Only long-dormant workspaces leave the list.",
		testId: "settle-idle-14",
	},
	{
		id: "never",
		label: "Never",
		description: "Only a merged or closed pull request, or Settle by hand, moves a workspace.",
		testId: "settle-idle-never",
	},
];

function toChoice(days: number | null): IdleChoice {
	if (days === null) return "never";
	const match = IDLE_CHOICES.find((choice) => choice.id === String(days));
	return match ? match.id : "3";
}

export function WorkspacesSettings() {
	const settleIdleDays = useAppStore((s) => s.settleIdleDays);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const supported =
		protocolVersion !== null && protocolVersion >= WORKSPACE_SETTLE_PROTOCOL_VERSION;

	const select = (choice: IdleChoice) => {
		const next = choice === "never" ? null : Number(choice);
		if (next === settleIdleDays) return;
		getTransport()
			.request("settings.update", { config: { settleIdleDays: next } })
			.catch(() => toast.error("Couldn't change the settle window"));
	};

	return (
		<section data-testid="settings-workspaces" className="flex flex-col gap-16">
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Settle idle workspaces after</h3>
					<p className="text-text-muted tr-text-metadata">
						A quiet workspace moves to its project's Settled shelf after this long without a chat, a
						terminal command, or a commit. Open pull requests, running agents, and unread results
						never settle; Keep active or any real work brings a workspace back.
					</p>
				</div>
				<SettingsRadioCards
					name="settle-idle-days"
					label="Settle idle workspaces after"
					choices={IDLE_CHOICES}
					value={toChoice(settleIdleDays)}
					disabled={!supported}
					onSelect={select}
				/>
			</div>
		</section>
	);
}
