const host = globalThis.__thinkrailExtensionHost;
if (host?.api.split(".")[0] !== "1") throw new Error("ThinkRail extension host API 1 unavailable");
const { jsx } = host.modules["react/jsx-runtime"];

function ThrowingCard() {
	throw new Error("e2e card failure");
}

function FineCard({ args }) {
	return jsx("div", { "data-testid": "e2e-fine-card", children: String(args.label ?? "") });
}

const card = { prominence: "primary", defaultExpanded: true };

export default {
	name: "e2e-ext-cards",
	toolRenderers: {
		e2e_throwing_tool: { renderer: ThrowingCard, options: card },
		e2e_fine_tool: { renderer: FineCard, options: card },
	},
};
