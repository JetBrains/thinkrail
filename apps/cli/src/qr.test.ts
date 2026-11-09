import { expect, test } from "bun:test";
import { renderQr } from "./qr";

test("renders a non-empty multi-line terminal QR for a pairing link", async () => {
	const out = await renderQr("thinkrail://pair?v=1&s=ws://relay:1&t=tok&k=KEY&p=proj");
	expect(out.length).toBeGreaterThan(0);
	expect(out.split("\n").length).toBeGreaterThan(5);
});
