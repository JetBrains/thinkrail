export interface WindowsProcessTreeHost {
	platform: NodeJS.Platform;
	taskkill: (pid: number) => void;
}

export const nativeWindowsProcessTreeHost: WindowsProcessTreeHost = {
	platform: process.platform,
	taskkill: (pid) => {
		Bun.spawnSync(["taskkill.exe", "/PID", String(pid), "/T", "/F"], {
			stdout: "ignore",
			stderr: "ignore",
		});
	},
};

export function killWindowsProcessTree(
	pid: number | undefined,
	host: WindowsProcessTreeHost = nativeWindowsProcessTreeHost,
): void {
	if (pid === undefined || host.platform !== "win32") return;
	try {
		host.taskkill(pid);
	} catch {}
}
