import { TERMINAL_REPLAY_KB } from "@thinkrail/contracts";
import { Check } from "lucide-react";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

const REPLAY_CHOICES: { kb: number; label: string; hint: string }[] = [
	{ kb: 0, label: "Off", hint: "Reattaching shows an empty screen over the live shell" },
	{ kb: 16, label: "16 KB", hint: "About a screenful" },
	{ kb: TERMINAL_REPLAY_KB.default, label: "64 KB", hint: "A screenful plus scrollback (default)" },
	{ kb: 256, label: "256 KB", hint: "Long scrollback; more memory per terminal" },
	{ kb: TERMINAL_REPLAY_KB.max, label: "1 MB", hint: "Maximum" },
];

export function TerminalSettings() {
	const replayKb = useAppStore((s) => s.terminalReplayKb);

	const select = (kb: number) => {
		if (kb === replayKb) return;
		getTransport()
			.request("settings.update", { config: { terminalReplayKb: kb } })
			.catch(() => toast.error("Couldn't change the replay size"));
	};

	return (
		<section data-testid="settings-terminal" className="flex flex-col gap-sm">
			<div className="flex flex-col gap-xs">
				<h3 className="tr-title-section text-text-default">Replayed output</h3>
				<p className="text-text-muted tr-text-metadata">
					A terminal keeps running when you leave it, but the view is rebuilt from scratch when you
					come back. This is how much of its recent output the host keeps so the screen is restored
					too. Applies to terminals opened from now on.
				</p>
			</div>
			<div className="flex flex-col gap-xs">
				{REPLAY_CHOICES.map(({ kb, label, hint }) => {
					const active = kb === replayKb;
					return (
						<button
							key={kb}
							type="button"
							aria-pressed={active}
							data-testid={`terminal-replay-${kb}`}
							data-active={active}
							onClick={() => select(kb)}
							className={cn(
								"flex items-center gap-sm rounded-[var(--radius-sm)] border px-md py-sm text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
								active
									? "border-primary-muted bg-clip-padding bg-primary-subtle text-text-default"
									: "border-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
							)}
						>
							<span className="flex-1">{label}</span>
							<span className="shrink-0 text-text-muted tr-text-metadata">{hint}</span>
							{active ? <Check className="size-4 shrink-0 text-primary" /> : null}
						</button>
					);
				})}
			</div>
		</section>
	);
}
