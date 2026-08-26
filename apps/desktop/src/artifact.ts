import { existsSync, globSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export function locateDesktopLauncher(desktopDir: string, explicit?: string): string {
	if (explicit) {
		const launcher = resolve(explicit);
		if (!existsSync(launcher))
			throw new Error(`packaged desktop launcher not found at ${launcher}`);
		return launcher;
	}
	const os =
		process.platform === "darwin" ? "macos" : process.platform === "win32" ? "win" : "linux";
	const name = process.platform === "win32" ? "launcher.exe" : "launcher";
	const matches = globSync(join(desktopDir, "build", `dev-${os}-${process.arch}`, "**", name));
	const launcher = matches.find((path) =>
		process.platform === "darwin"
			? path.includes(".app/Contents/MacOS/")
			: path.includes(`${sep}bin${sep}`),
	);
	if (!launcher) {
		throw new Error("packaged desktop launcher not found — run `bun run desktop:build` first");
	}
	return launcher;
}
