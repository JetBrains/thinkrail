// Best-effort host-side browser open for OAuth URLs. V1 runs host == user's machine, so opening here
// is the happy path; the URL always also rides the `auth-url` event so a remote client (V2) can open
// or copy it on its side when this silently does nothing useful.

export function openBrowser(url: string): void {
	// Tests + headless hosts opt out; the URL still reaches the client via the auth-url event.
	if (process.env.THINKRAIL_NO_BROWSER === "1") return;
	try {
		const [cmd, ...args] =
			process.platform === "darwin"
				? ["open", url]
				: process.platform === "win32"
					? ["cmd", "/c", "start", "", url]
					: ["xdg-open", url];
		Bun.spawn([cmd as string, ...args], {
			stdout: "ignore",
			stderr: "ignore",
			stdin: "ignore",
		});
	} catch {
		// Never let a browser-open failure break a login flow — the UI shows the URL regardless.
	}
}
