import { expect, test } from "bun:test";
import { EXTENSION_QUERY_PROTOCOL_VERSION, type ExtensionCatalogEntry } from "@thinkrail/contracts";
import type { RegisteredStatusItem } from "../extensions";
import { mountedStatusItems } from "./ExtensionStatusItems";

const item = (extension: string): RegisteredStatusItem => ({
	extension,
	item: "inbox",
	declaration: { load: async () => ({ default: () => null }) },
});

const entry = (name: string): ExtensionCatalogEntry => ({
	name,
	title: name,
	enabled: true,
	tools: [],
	hasChildExtensions: false,
	apiVersion: 1,
});

test("a status item mounts only while its extension is on, served and listed by the host", () => {
	const items = [item("board"), item("other")];
	const mounted = (input: Partial<Parameters<typeof mountedStatusItems>[0]>) =>
		mountedStatusItems({
			disabled: [],
			protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION,
			catalog: [entry("board")],
			items,
			...input,
		}).map(({ item: { extension }, entry: { apiVersion } }) => [extension, apiVersion]);

	expect(mounted({})).toEqual([["board", 1]]);
	expect(mounted({ disabled: ["board"] })).toEqual([]);
	expect(mounted({ protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION - 1 })).toEqual([]);
	expect(mounted({ protocolVersion: null })).toEqual([]);
	expect(mounted({ catalog: "loading" })).toEqual([]);
	expect(mounted({ catalog: "failed" })).toEqual([]);
	expect(mounted({ catalog: [entry("board"), entry("other")] })).toEqual([
		["board", 1],
		["other", 1],
	]);
});
