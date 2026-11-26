const host = globalThis.__thinkrailExtensionHost;
if (host?.api.split(".")[0] !== "1") throw new Error("ThinkRail extension host API 1 unavailable");

function WeatherCardV2() {
	return null;
}

export default {
	name: "weather",
	toolRenderers: { weather: { renderer: WeatherCardV2 } },
};
