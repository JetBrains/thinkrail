export interface LfsPointer {
	oid: string;
	size: number;
}

export function parseLfsPointer(text: string): LfsPointer | null {
	const lines = text.split("\n");
	if (lines[0] !== "version https://git-lfs.github.com/spec/v1") return null;
	let oid: string | undefined;
	let size: number | undefined;
	for (const line of lines.slice(1)) {
		const match = /^oid sha256:([0-9a-f]{64})$/.exec(line);
		if (match?.[1]) oid = match[1];
		const sized = /^size (\d+)$/.exec(line);
		if (sized?.[1]) size = Number(sized[1]);
	}
	return oid !== undefined && size !== undefined ? { oid, size } : null;
}

export function formatLfsSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
