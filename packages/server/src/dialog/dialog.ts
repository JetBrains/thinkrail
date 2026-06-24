// Native directory picker, run on the host (the machine the repos live on). In dev/e2e,
// THINKRAIL_PI_PICK_DIR overrides it so the flow is drivable headlessly.

export async function selectDirectory(): Promise<{ path: string | null }> {
	const override = process.env.THINKRAIL_PI_PICK_DIR;
	if (override) return { path: override };

	if (process.platform === "darwin") {
		const proc = Bun.spawn(
			["osascript", "-e", 'POSIX path of (choose folder with prompt "Open project")'],
			{ stdout: "pipe", stderr: "ignore" },
		);
		const out = await new Response(proc.stdout).text();
		const code = await proc.exited;
		if (code !== 0) return { path: null }; // cancelled
		const picked = out.trim().replace(/\/$/, "");
		return { path: picked || null };
	}

	// Linux/Windows native pickers (+ a manual-path fallback) arrive with the desktop work.
	return { path: null };
}
