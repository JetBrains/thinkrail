export function onFontsChange(onChange: () => void): () => void {
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-fonts"],
	});
	return () => observer.disconnect();
}

export function fontsRevision(): string {
	return document.documentElement.dataset.fonts ?? "";
}

function fontFacesRevision(): string {
	return document.documentElement.dataset.fontFaces ?? "";
}

export interface ResolvedFont {
	family: string;
	size: number;
	weight: number;
	ligatures: boolean;
}

export function resolveFont(className: string): ResolvedFont {
	const probe = document.createElement("span");
	probe.className = className;
	probe.setAttribute("aria-hidden", "true");
	probe.style.setProperty("position", "absolute");
	probe.style.setProperty("visibility", "hidden");
	document.body.append(probe);
	const style = getComputedStyle(probe);
	const resolved = {
		family: style.fontFamily,
		size: Number.parseFloat(style.fontSize),
		weight: Number.parseFloat(style.fontWeight),
		ligatures: style.fontVariantLigatures !== "none",
	};
	probe.remove();
	return resolved;
}

export function fontsLoaded({ family, size, weight }: ResolvedFont): Promise<void> {
	return document.fonts.load(`${weight} ${size}px ${family}`).then(
		() => undefined,
		() => undefined,
	);
}

export function watchFont(
	className: string,
	fields: readonly (keyof ResolvedFont)[],
	onChange: (font: ResolvedFont) => void,
): () => void {
	let applied = { font: resolveFont(className), faces: fontFacesRevision() };
	let latest = 0;
	return onFontsChange(() => {
		latest = latest + 1;
		const request = latest;
		const next = { font: resolveFont(className), faces: fontFacesRevision() };
		void fontsLoaded(next.font).then(() => {
			if (request !== latest) return;
			const same = fields.every((field) => next.font[field] === applied.font[field]);
			if (same && next.faces === applied.faces) return;
			applied = next;
			onChange(next.font);
		});
	});
}
