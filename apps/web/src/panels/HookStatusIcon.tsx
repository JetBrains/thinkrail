import type { HookStatus } from "@thinkrail/contracts";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";

/** The status-icon convention shared by the workspace row's badge and the Hooks panel's per-hook rows —
 * mirrors `ToolCard`'s running/error/done icon set, plus `awaitingApproval` (no tool-card precedent). */
export function HookStatusIcon({ state }: { state: HookStatus["state"] }) {
	switch (state) {
		case "running":
			return (
				<Loader2 className="size-3.5 shrink-0 animate-spin text-muted motion-reduce:animate-none" />
			);
		case "failed":
			return <X className="size-3.5 shrink-0 text-red" />;
		case "succeeded":
			return <Check className="size-3.5 shrink-0 text-green" />;
		case "awaitingApproval":
			return <TriangleAlert className="size-3.5 shrink-0 text-gold" />;
	}
}
