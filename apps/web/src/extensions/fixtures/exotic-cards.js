const host = globalThis.__thinkrailExtensionHost;
if (host?.api.split(".")[0] !== "1") throw new Error("ThinkRail extension host API 1 unavailable");
const { jsx } = host.modules["react/jsx-runtime"];
const { forwardRef, lazy, memo } = host.modules.react;

function Card({ args }) {
	return jsx("section", { "data-exotic-card": args.kind });
}

export default {
	name: "exotic",
	toolRenderers: {
		memo_tool: { renderer: memo(Card) },
		forward_ref_tool: { renderer: forwardRef((props, _ref) => Card(props)) },
		lazy_tool: { renderer: lazy(async () => ({ default: Card })) },
	},
};
