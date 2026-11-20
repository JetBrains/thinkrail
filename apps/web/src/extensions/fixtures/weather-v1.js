const host = globalThis.__thinkrailExtensionHost;
if (host?.api.split(".")[0] !== "1") throw new Error("ThinkRail extension host API 1 unavailable");
const { jsx, jsxs } = host.modules["react/jsx-runtime"];
const { useState } = host.modules.react;
const { ResourcePreview, useResourceScope } = host.modules["@thinkrail/extension-sdk/resources"];

function WeatherCard({ args, interaction }) {
	const [version] = useState("v1");
	const scope = useResourceScope();
	return jsxs("section", {
		"data-weather-card": version,
		"data-scope-workspace": scope?.workspaceId ?? "none",
		"data-scope-session": scope?.sessionId ?? "none",
		"data-interactive": interaction ? "yes" : "no",
		"data-accepting": String(interaction?.state.accepting ?? false),
		children: [
			args.city,
			args.path ? jsx(ResourcePreview, { path: args.path, compact: true }) : null,
		],
	});
}

function Forecast() {
	return null;
}

export default {
	name: "weather",
	toolRenderers: {
		weather: {
			renderer: WeatherCard,
			options: {
				prominence: "primary",
				interactive: true,
				summary: ({ args }) => `forecast for ${args.city}`,
			},
		},
		forecast: { renderer: Forecast },
	},
};
