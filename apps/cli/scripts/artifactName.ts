export function targetsWindows(target?: string): boolean {
	return target ? target.includes("windows") : process.platform === "win32";
}

export function binaryArtifactName(target?: string): string {
	const base = target ? `thinkrail-${target.replace(/^bun-/, "")}` : "thinkrail";
	return targetsWindows(target) ? `${base}.exe` : base;
}
