import type { Locator, Page } from "@playwright/test";

export interface ChatScrollGeometry {
	scrollTop: number;
	clientHeight: number;
	scrollHeight: number;
	maxScrollTop: number;
	distanceFromStart: number;
	distanceFromEnd: number;
	center: { x: number; y: number };
}

export interface ChatViewportIntersection {
	intersectionHeight: number;
	elementHeight: number;
	viewportHeight: number;
	intersects: boolean;
}

export async function readChatScrollGeometry(chatScroll: Locator): Promise<ChatScrollGeometry> {
	return chatScroll.evaluate((root) => {
		const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
		if (!scroller) throw new Error("missing Virtuoso scroller");
		const rect = scroller.getBoundingClientRect();
		const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
		return {
			scrollTop: scroller.scrollTop,
			clientHeight: scroller.clientHeight,
			scrollHeight: scroller.scrollHeight,
			maxScrollTop,
			distanceFromStart: scroller.scrollTop,
			distanceFromEnd: Math.max(0, maxScrollTop - scroller.scrollTop),
			center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
		};
	});
}

export async function moveMouseToChatViewport(page: Page, chatScroll: Locator): Promise<void> {
	const { center } = await readChatScrollGeometry(chatScroll);
	await page.mouse.move(center.x, center.y);
}

export async function readChatViewportIntersection(
	element: Locator,
): Promise<ChatViewportIntersection> {
	return element.evaluate((node) => {
		const scroller = node.closest<HTMLElement>("[data-virtuoso-scroller]");
		if (!scroller) throw new Error("element is not inside a Virtuoso scroller");
		const elementRect = node.getBoundingClientRect();
		const viewportRect = scroller.getBoundingClientRect();
		const intersectionHeight = Math.max(
			0,
			Math.min(elementRect.bottom, viewportRect.bottom) -
				Math.max(elementRect.top, viewportRect.top),
		);
		return {
			intersectionHeight,
			elementHeight: elementRect.height,
			viewportHeight: viewportRect.height,
			intersects: intersectionHeight > 0,
		};
	});
}

export interface NestedVerticalScrollSurface {
	tag: string;
	testId: string | null;
	overflowY: string;
	clientHeight: number;
	scrollHeight: number;
}

export async function nestedVerticalScrollSurfaces(
	root: Locator,
): Promise<NestedVerticalScrollSurface[]> {
	return root.evaluate((element) =>
		[...element.querySelectorAll<HTMLElement>("*")].flatMap((candidate) => {
			const overflowY = getComputedStyle(candidate).overflowY;
			if (
				!(["auto", "scroll", "overlay"] as string[]).includes(overflowY) ||
				candidate.scrollHeight <= candidate.clientHeight
			) {
				return [];
			}
			return [
				{
					tag: candidate.tagName.toLowerCase(),
					testId: candidate.dataset.testid ?? null,
					overflowY,
					clientHeight: candidate.clientHeight,
					scrollHeight: candidate.scrollHeight,
				},
			];
		}),
	);
}
