export interface LfsPointer {
	oid: string;
	size: number;
}

const POINTER =
	/^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d{1,15})\n$/;

export function parseLfsPointer(text: string): LfsPointer | null {
	const match = POINTER.exec(text);
	return match?.[1] && match[2] ? { oid: match[1], size: Number(match[2]) } : null;
}

function formatLfsValue(value: number): string {
	return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

export function formatLfsSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	// Compare the rounded figure: 1023.6 KB would otherwise be shown as "1024 KB".
	while (Number(formatLfsValue(value)) >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${formatLfsValue(value)} ${units[unit]}`;
}
