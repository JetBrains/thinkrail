const THEME_MESSAGE = "thinkrail:theme";
const HEIGHT_MESSAGE = "thinkrail:height";
const READY_MESSAGE = "thinkrail:ready";
const LEAVE_MESSAGE = "thinkrail:leave";
export const THEME_CHANGE_EVENT = "thinkrail:themechange";

export function frameNonce() {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function frameBootstrap(nonce: string) {
	return `(() => {
	const script = document.currentScript;
	const theme = script.previousElementSibling;
	script.remove();
	const nonce = ${JSON.stringify(nonce)};
	const post = (message) => parent.postMessage({ ...message, nonce }, "*");
	addEventListener("message", (event) => {
		const data = event.data;
		if (event.source === parent && data && data.type === "${THEME_MESSAGE}" && typeof data.css === "string") {
			theme.textContent = data.css;
			dispatchEvent(new Event("${THEME_CHANGE_EVENT}"));
		}
	});
	addEventListener("pagehide", () => post({ type: "${LEAVE_MESSAGE}" }));
	let last = -1;
	const report = () => {
		const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
		if (height === last) return;
		last = height;
		post({ type: "${HEIGHT_MESSAGE}", height });
	};
	const observer = new ResizeObserver(report);
	observer.observe(document.documentElement);
	document.addEventListener("DOMContentLoaded", () => {
		if (document.body) observer.observe(document.body);
		report();
	});
	addEventListener("load", () => {
		post({ type: "${READY_MESSAGE}" });
		report();
	});
})();`;
}

export function themeMessage(css: string) {
	return { type: THEME_MESSAGE, css };
}

export function frameMessage(data: unknown, nonce: string) {
	if (typeof data !== "object" || data === null || Reflect.get(data, "nonce") !== nonce)
		return null;
	const type = Reflect.get(data, "type");
	if (type === READY_MESSAGE) return { kind: "ready" } as const;
	if (type === LEAVE_MESSAGE) return { kind: "leave" } as const;
	if (type !== HEIGHT_MESSAGE) return null;
	const height = Reflect.get(data, "height");
	return typeof height === "number" && Number.isFinite(height) && height >= 0
		? ({ kind: "height", height } as const)
		: null;
}
