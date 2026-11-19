import { describe, expect, it } from "bun:test";
import type { WireImage } from "@thinkrail/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ChatImage,
	type ChatMedia,
	ChatMediaContext,
	chatImageUrl,
	INITIAL_IMAGE_LOAD,
	imageLoadFailed,
	imageLoadRetried,
	imageLoadSucceeded,
	imageLoadView,
} from "./ChatImage";

const REF = `/images/session-1/${"a".repeat(64)}`;
const refImage: WireImage = {
	type: "image",
	mimeType: "image/png",
	ref: REF,
	width: 800,
	height: 600,
};
const media: ChatMedia = { resolveUrl: (ref) => `http://host.test${ref}`, retryEpoch: 3 };

function render(image: WireImage, value: ChatMedia | null) {
	return renderToStaticMarkup(
		createElement(
			ChatMediaContext.Provider,
			{ value },
			createElement(ChatImage, { image, label: "shot.png", fit: "thumbnail", testId: "thumb" }),
		),
	);
}

describe("ChatImage", () => {
	it("loads a host reference by URL and reserves its box from the sniffed size", () => {
		const markup = render(refImage, media);
		expect(markup).toContain(`src="http://host.test${REF}"`);
		expect(markup).toContain('width="800"');
		expect(markup).toContain('height="600"');
		expect(markup).toContain('data-testid="thumb"');
		expect(markup).not.toContain("chat-image-unavailable");
	});

	it("renders an inline block, such as the optimistic echo, from its data", () => {
		const markup = render({ type: "image", mimeType: "image/jpeg", data: "anBn" }, null);
		expect(markup).toContain('src="data:image/jpeg;base64,anBn"');
	});

	it("shows the unavailable tile without a retry when no host can resolve the reference", () => {
		const markup = render(refImage, null);
		expect(markup).toContain('data-testid="chat-image-unavailable"');
		expect(markup).toContain("Image unavailable");
		expect(markup).not.toContain("chat-image-retry");
		expect(markup).not.toContain("<img");
	});
});

describe("image load state", () => {
	it("a failure keeps the tile through the resync epoch's reload until the image loads", () => {
		const failed = imageLoadFailed(INITIAL_IMAGE_LOAD, 3);
		expect(imageLoadView(failed, 3)).toEqual({ query: null, unavailable: true });

		const afterResync = imageLoadView(failed, 4);
		expect(afterResync).toEqual({ query: "epoch-4", unavailable: true });
		expect(chatImageUrl(refImage, { ...media, retryEpoch: 4 }, afterResync.query)).toBe(
			`http://host.test${REF}?retry=epoch-4`,
		);

		const loaded = imageLoadSucceeded(failed, 4);
		expect(imageLoadView(loaded, 4)).toEqual({ query: "epoch-4", unavailable: false });
		expect(imageLoadView(loaded, 5)).toEqual({ query: "epoch-4", unavailable: false });

		const failedAgain = imageLoadFailed(failed, 4);
		expect(imageLoadView(failedAgain, 4)).toEqual({ query: "epoch-4", unavailable: true });
	});

	it("a manual retry requests a fresh URL at once and keeps the tile until it loads", () => {
		const failed = imageLoadFailed(INITIAL_IMAGE_LOAD, 3);
		const retried = imageLoadRetried(failed, 3, "1");
		expect(imageLoadView(retried, 3)).toEqual({ query: "manual-1", unavailable: true });
		expect(imageLoadView(imageLoadRetried(retried, 3, "2"), 3).query).toBe("manual-2");
		expect(imageLoadView(imageLoadSucceeded(retried, 3), 3)).toEqual({
			query: "manual-1",
			unavailable: false,
		});
		expect(imageLoadView(imageLoadFailed(retried, 3), 3)).toEqual({
			query: "manual-1",
			unavailable: true,
		});
	});

	it("a successful first load never reloads on later reconnects", () => {
		const loaded = imageLoadSucceeded(INITIAL_IMAGE_LOAD, 3);
		expect(loaded).toBe(INITIAL_IMAGE_LOAD);
		expect(imageLoadView(loaded, 9)).toEqual({ query: null, unavailable: false });
	});
});
