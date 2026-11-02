import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";

const PRESETS = [
	{ id: "0", label: "common.off" },
	{ id: "16", label: "settings.terminal.scrollback.kb16" },
	{ id: "64", label: "settings.terminal.scrollback.kb64" },
] as const;

export default function NoSelection() {
	const t = useT();
	const [replayKb, setReplayKb] = useState(128);
	const value = PRESETS.find((option) => Number(option.id) === replayKb)?.id ?? null;
	return (
		<div className="flex flex-col items-start gap-8">
			<SegmentedControl
				name="terminal-scrollback-example"
				label={t("settings.terminal.scrollback.label")}
				options={PRESETS.map((option) => ({ ...option, label: t(option.label) }))}
				value={value}
				onSelect={(id) => setReplayKb(Number(id))}
			/>
			<output className="tr-text-metadata text-text-muted">{replayKb} KB</output>
		</div>
	);
}
