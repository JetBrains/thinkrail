export function initImageZoom(root: ParentNode = document): void {
	const links = Array.from(
		root.querySelectorAll<HTMLAnchorElement>(".blog-post-content table a:has(> img)"),
	);
	if (links.length === 0) return;

	const dialog = document.createElement("dialog");
	dialog.className = "image-zoom";
	const full = document.createElement("img");
	dialog.append(full);
	dialog.addEventListener("click", () => dialog.close());
	document.body.append(dialog);

	for (const link of links) {
		link.addEventListener("click", (event) => {
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			event.preventDefault();
			full.src = link.href;
			full.alt = link.querySelector("img")?.alt ?? "";
			dialog.showModal();
		});
	}
}
