import { expect, test } from "bun:test";
import { createWorkspaceAssetResolver, MAX_MOCKUP_ASSET_BYTES } from "./workspaceAssets";

function resolverFor(response: Response, asked: string[] = []) {
	return createWorkspaceAssetResolver("ws 1", {
		bytesUrl: (workspaceId, path) => `http://host/files/${workspaceId}/${path}`,
		fetchBytes: async (url) => {
			asked.push(url);
			return response;
		},
		toDataUrl: async (blob) => `data:${blob.type};bytes=${blob.size}`,
	});
}

test("fetches the workspace file through the byte route and returns a data URL", async () => {
	const asked: string[] = [];
	const resolve = resolverFor(
		new Response(new Blob(["<svg/>"], { type: "image/svg+xml" }), { status: 200 }),
		asked,
	);
	expect(await resolve("img/logo.svg")).toBe("data:image/svg+xml;bytes=6");
	expect(asked).toEqual(["http://host/files/ws 1/img/logo.svg"]);
});

test("a missing file or an oversized one resolves to null", async () => {
	expect(await resolverFor(new Response("nope", { status: 404 }))("a.png")).toBeNull();
	const big = new Response("x", {
		status: 200,
		headers: { "content-length": String(MAX_MOCKUP_ASSET_BYTES + 1) },
	});
	expect(await resolverFor(big)("a.png")).toBeNull();
	const bigBody = new Response(new Uint8Array(MAX_MOCKUP_ASSET_BYTES + 1), { status: 200 });
	expect(await resolverFor(bigBody)("a.png")).toBeNull();
});
