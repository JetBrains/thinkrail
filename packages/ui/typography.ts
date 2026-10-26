export function onFontChange(onChange: () => void): () => void {
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-fonts"],
	});
	return () => observer.disconnect();
}
