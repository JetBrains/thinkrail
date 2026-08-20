const ESC = String.fromCharCode(27);
const SGR_SEQUENCE = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

export function terminalContrastFloor(isHighContrast: boolean): number {
	return isHighContrast ? 7 : 4.5;
}

function filterDimSgrParams(params: string): string {
	const parts = params.split(";");
	const kept: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === undefined) continue;
		if (part === "38" || part === "48") {
			kept.push(part);
			const mode = parts[i + 1];
			if (mode === undefined) continue;
			kept.push(mode);
			i += 1;
			const subCount = mode === "2" ? 3 : mode === "5" ? 1 : 0;
			for (let k = 0; k < subCount; k++) {
				const sub = parts[i + 1];
				if (sub === undefined) break;
				kept.push(sub);
				i += 1;
			}
			continue;
		}
		if (part === "2") continue;
		kept.push(part);
	}
	return kept.join(";");
}

export function stripAnsiDim(data: string): string {
	return data.replace(SGR_SEQUENCE, (full, params: string) => {
		const kept = filterDimSgrParams(params);
		if (kept === params) return full;
		if (kept === "") return "";
		return `${ESC}[${kept}m`;
	});
}
