export function applyLinuxWebKitRendererWorkaround(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): void {
	if (platform !== "linux") return;
	if (env.WEBKIT_DISABLE_DMABUF_RENDERER !== undefined) return;
	env.WEBKIT_DISABLE_DMABUF_RENDERER = "1";
}

// Must evaluate before any Electrobun import — see electrobun-compatibility.md.
applyLinuxWebKitRendererWorkaround(process.env, process.platform);
