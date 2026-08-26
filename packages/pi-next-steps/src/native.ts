import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentOffer } from "./offer.ts";

export const SELECTOR_TITLE = "Next steps";

export type OfferHost = Pick<ExtensionAPI, "sendUserMessage">;

export type OfferOutcome = "unsupported" | "none" | "cancelled" | "sent" | "queued";

export async function presentOffer(host: OfferHost, ctx: ExtensionContext): Promise<OfferOutcome> {
	if (ctx.mode !== "tui") return "unsupported";
	const offer = currentOffer(ctx.sessionManager.getBranch());
	if (!offer) return "none";
	const picked = await ctx.ui.select(
		SELECTOR_TITLE,
		offer.items.map((item) => item.label),
	);
	const chosen = offer.items.find((item) => item.label === picked);
	if (!chosen) return "cancelled";
	if (ctx.isIdle()) {
		host.sendUserMessage(chosen.prompt);
		return "sent";
	}
	host.sendUserMessage(chosen.prompt, { deliverAs: "followUp" });
	return "queued";
}

export function presentOfferDetached(host: OfferHost, ctx: ExtensionContext): void {
	presentOffer(host, ctx).catch(() => undefined);
}
