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

export function fontsLoaded({ family, size }: ResolvedFont): Promise<void> {
	return document.fonts.load(`${size}px ${family}`).then(
		() => undefined,
		() => undefined,
	);
}
