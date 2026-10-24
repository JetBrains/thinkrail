import type { NativeQuitHint } from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { platformShortcutLabel } from "../lib";

type VisibleQuitHint = Exclude<NativeQuitHint, "hidden">;

function quitHintText(t: Translator, hint: VisibleQuitHint) {
	if (hint === "release") return t("shell.quitHint.release");
	if (hint === "quitting") return t("shell.quitHint.quitting");
	return t("shell.quitHint.hold", { shortcut: platformShortcutLabel("Q") });
}

export function QuitHintOverlay({ hint }: { hint: NativeQuitHint }) {
	const t = useT();
	const [lastVisible, setLastVisible] = useState<VisibleQuitHint | null>(null);
	if (hint !== "hidden" && hint !== lastVisible) setLastVisible(hint);
	const hidden = hint === "hidden" || !lastVisible;
	return (
		<div
			role="status"
			aria-live="polite"
			data-testid="quit-hint"
			data-hint={hint}
			className={cn(
				"pointer-events-none fixed inset-0 z-200 flex items-center justify-center bg-overlay transition-opacity duration-200 ease-out",
				hidden ? "opacity-0" : "opacity-100",
			)}
		>
			{lastVisible ? (
				<div
					aria-hidden={hidden}
					className="rounded-lg border border-border-default bg-container-elevated-bg px-24 py-16 text-text-default tr-heading-lg shadow-(--shadow-lg)"
				>
					{quitHintText(t, lastVisible)}
				</div>
			) : null}
		</div>
	);
}
