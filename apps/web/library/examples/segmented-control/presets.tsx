import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";

type Scrollback = "0" | "16" | "64" | "256" | "1024";

export default function Presets() {
	const t = useT();
	const [replayKb, setReplayKb] = useState<Scrollback>("256");
	return (
		<div className="flex flex-col gap-12">
			<div className="flex flex-col gap-2">
				<span className="tr-text-ui text-text-default">
					{t("settings.terminal.scrollback.title")}
				</span>
				<span className="tr-text-metadata text-text-muted">
					{t("settings.terminal.scrollback.description")}
				</span>
			</div>
			<SegmentedControl
				name="terminal-scrollback"
				label={t("settings.terminal.scrollback.label")}
				options={[
					{ id: "0", label: t("common.off"), testId: "terminal-replay-0" },
					{ id: "16", label: t("settings.terminal.scrollback.kb16"), testId: "terminal-replay-16" },
					{ id: "64", label: t("settings.terminal.scrollback.kb64"), testId: "terminal-replay-64" },
					{
						id: "256",
						label: t("settings.terminal.scrollback.kb256"),
						testId: "terminal-replay-256",
					},
					{
						id: "1024",
						label: t("settings.terminal.scrollback.mb1"),
						testId: "terminal-replay-1024",
					},
				]}
				value={replayKb}
				onSelect={setReplayKb}
				testId="terminal-scrollback-control"
			/>
		</div>
	);
}
