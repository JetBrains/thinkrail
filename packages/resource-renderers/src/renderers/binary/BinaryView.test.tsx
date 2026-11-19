import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ResourceHost, ResourceHostProvider } from "../../host";
import type { ResourceContent, ResourceDescriptor } from "../../registry";
import BinaryView from "./BinaryView";

const host: ResourceHost = {
	markdown: () => null,
	code: {
		languages: [],
		languageId: () => null,
		pierreTheme: { name: "test", appearance: "dark", style: {} },
		editorTheme: () => ({ rules: [], colors: {} }),
	},
	bytesUrl: () => "",
	openFile: () => {},
	openPathExternally: () => {},
	revealInFileManager: () => {},
	openComparison: () => {},
	readFile: async () => ({ content: "" }),
	subscribeFileChanges: () => () => {},
	FileReview: () => null,
	ReviewSend: () => null,
};

const resource: ResourceDescriptor = {
	workspaceId: "ws",
	path: "reports/q3.xlsx",
	text: false,
	byteLength: 128,
};

const bytes: ResourceContent = {
	kind: "bytes",
	url: "http://host.test/files/ws/reports/q3.xlsx",
	hash: "0123456789abcdef",
	byteLength: 128,
};

function renderView(withHost: boolean): string {
	const view = createElement(BinaryView, { resource, content: bytes });
	return withHost
		? renderToStaticMarkup(createElement(ResourceHostProvider, { value: host }, view))
		: renderToStaticMarkup(view);
}

test("the external-open action is a host action, not a webview download of a copy", () => {
	const markup = renderView(true);
	expect(markup).toContain("Open externally");
	expect(markup).not.toContain("download=");
	expect(markup).not.toContain("<a ");
});

test("a reveal-in-file-manager action ships next to it", () => {
	const markup = renderView(true);
	expect(markup).toContain("Reveal in file manager");
});

test("both actions stay hidden without a resource host", () => {
	const markup = renderView(false);
	expect(markup).not.toContain("<button");
	expect(markup).not.toContain("<a ");
});
