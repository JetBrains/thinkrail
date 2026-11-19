export function searchTerms(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesSearch(haystack: string, terms: readonly string[]): boolean {
	return terms.every((term) => haystack.includes(term));
}

export function extensionCountLabel(shown: number, total: number): string {
	const noun = total === 1 ? "extension" : "extensions";
	return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}

export function initExtensionsPage(root: ParentNode = document): void {
	const page = root.querySelector<HTMLElement>("[data-extensions]");
	if (!page) return;

	for (const media of page.querySelectorAll<HTMLElement>(".ext-card-media")) {
		const image = media.querySelector<HTMLImageElement>(".ext-card-image");
		if (!image) continue;
		const fail = () => media.classList.add("broken");
		image.addEventListener("error", fail, { once: true });
		if (image.complete && image.naturalWidth === 0) fail();
	}

	const box = page.querySelector<HTMLElement>("[data-extension-search-box]");
	const input = page.querySelector<HTMLInputElement>("[data-extension-search-input]");
	const count = page.querySelector<HTMLElement>("[data-extension-count]");
	const noMatch = page.querySelector<HTMLElement>("[data-extension-no-match]");
	const cards = Array.from(page.querySelectorAll<HTMLElement>("[data-extension-search]"));
	if (!box || !input || !count || !noMatch || cards.length === 0) return;

	const apply = () => {
		const terms = searchTerms(input.value);
		let shown = 0;
		for (const card of cards) {
			const match = matchesSearch(card.dataset.extensionSearch ?? "", terms);
			card.hidden = !match;
			if (match) shown++;
		}
		count.textContent = extensionCountLabel(shown, cards.length);
		noMatch.hidden = shown > 0;
	};
	input.addEventListener("input", apply);
	box.hidden = false;
	apply();
}
