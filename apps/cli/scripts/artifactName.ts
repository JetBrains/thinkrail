export function binaryArtifactName(target?: string): string {
	const base = target ? `thinkrail-${target.replace(/^bun-/, "")}` : "thinkrail";
	const windows = target ? target.includes("windows") : process.platform === "win32";
	return windows ? `${base}.exe` : base;
}
