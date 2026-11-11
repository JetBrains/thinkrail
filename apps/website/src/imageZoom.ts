type ZoomClick = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export function zoomsInPlace(event: ZoomClick): boolean {
	return event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

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
	dialog.addEventListener("close", () => full.removeAttribute("src"));
	document.body.append(dialog);

	for (const link of links) {
		link.addEventListener("click", (event) => {
			if (!zoomsInPlace(event)) return;
			event.preventDefault();
			const alt = link.querySelector("img")?.alt ?? "";
			full.src = link.href;
			full.alt = alt;
			dialog.setAttribute("aria-label", alt);
			dialog.showModal();
		});
	}
}
