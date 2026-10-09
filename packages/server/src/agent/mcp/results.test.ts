import { expect, test } from "bun:test";
import { MCP_SUMMARY_BYTES, summarizeMcpResult } from "./results";

test("tool results keep block kinds, URIs, types and sizes but never block data", () => {
	const summary = summarizeMcpResult(
		"mcp__docs__search",
		{
			content: [
				{ type: "text", text: "hello" },
				{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
				{ type: "audio", data: "UklGRg==", mimeType: "audio/wav" },
				{ type: "resource_link", uri: "file:///a.md", name: "a.md", mimeType: "text/markdown" },
				{
					type: "resource",
					resource: { uri: "file:///b.txt", mimeType: "text/plain", text: "abc" },
				},
				{ type: "resource", resource: { uri: "file:///c.bin", blob: "AAAA" } },
			],
			structuredContent: { rows: [1, 2] },
		},
		true,
	);
	expect(summary).toEqual({
		blocks: [
			{ kind: "text", chars: 5 },
			{ kind: "image", mimeType: "image/png" },
			{ kind: "audio", mimeType: "audio/wav" },
			{ kind: "resource_link", uri: "file:///a.md", name: "a.md", mimeType: "text/markdown" },
			{ kind: "resource", uri: "file:///b.txt", mimeType: "text/plain", chars: 3 },
			{ kind: "resource", uri: "file:///c.bin" },
		],
		structuredContent: { rows: [1, 2] },
		isError: true,
	});
	expect(JSON.stringify(summary)).not.toMatch(/iVBOR|UklGR|AAAA/);
});

test("structured content is bounded, resource reads drop blobs, listings keep their payload", () => {
	const huge = { blob: "x".repeat(MCP_SUMMARY_BYTES) };
	expect(summarizeMcpResult("mcp__s__t", { content: [], structuredContent: huge }, false)).toEqual({
		blocks: [],
		structuredContentTruncated: true,
	});
	expect(
		summarizeMcpResult(
			"read_mcp_resource",
			{
				server: "s",
				uri: "u",
				contents: [{ uri: "file:///d.bin", mimeType: "image/png", blob: "AAAA" }],
			},
			false,
		),
	).toEqual({ blocks: [{ kind: "resource", uri: "file:///d.bin", mimeType: "image/png" }] });
	const listing = { resources: [{ server: "s", uri: "file:///e", name: "e" }] };
	expect(summarizeMcpResult("list_mcp_resources", listing, false)).toEqual({
		blocks: [],
		structuredContent: listing,
	});
	expect(summarizeMcpResult("mcp__s__t", undefined, false)).toBeNull();
});

test("one byte budget bounds blocks and structured content together", () => {
	const link = (i: number) => ({
		type: "resource_link",
		uri: `file:///${"x".repeat(1000)}/${i}`,
		name: `n${i}`,
	});
	const links = Array.from({ length: 200 }, (_, i) => link(i));
	const many = summarizeMcpResult(
		"mcp__s__t",
		{ content: links, structuredContent: { rows: [1] } },
		false,
	);
	if (!many) throw new Error("no summary");
	expect(many.blocks.length).toBeGreaterThan(0);
	expect(many.blocks.length).toBeLessThan(200);
	expect(many.omittedBlocks).toBe(200 - many.blocks.length);
	expect(many.blocks[0]).toEqual({ kind: "resource_link", uri: link(0).uri, name: "n0" });
	expect(many.structuredContent).toEqual({ rows: [1] });
	expect(Buffer.byteLength(JSON.stringify(many))).toBeLessThanOrEqual(MCP_SUMMARY_BYTES + 64);

	const half = { blob: "x".repeat(MCP_SUMMARY_BYTES / 2) };
	const shared = summarizeMcpResult(
		"mcp__s__t",
		{ content: links.slice(0, 40), structuredContent: half },
		false,
	);
	expect(shared?.blocks).toHaveLength(40);
	expect(shared?.omittedBlocks).toBeUndefined();
	expect(shared?.structuredContentTruncated).toBe(true);

	const read = summarizeMcpResult(
		"read_mcp_resource",
		{ contents: links.map((entry) => ({ uri: entry.uri, mimeType: "text/plain" })) },
		false,
	);
	expect(read?.blocks.length).toBeLessThan(200);
	expect(read?.omittedBlocks).toBe(200 - (read?.blocks.length ?? 0));
	expect(Buffer.byteLength(JSON.stringify(read))).toBeLessThanOrEqual(MCP_SUMMARY_BYTES + 64);
});
