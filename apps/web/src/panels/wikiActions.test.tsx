import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { WikiStatus } from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";

const requests: { method: string; params: unknown }[] = [];
const chats: { workspaceId: string; prompt: string }[] = [];
const openChat = (workspaceId: string, prompt: string) => {
	chats.push({ workspaceId, prompt });
	return Promise.resolve(true);
};
let respond: (method: string) => Promise<unknown> = () => Promise.resolve({});

const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: unknown) => {
			requests.push({ method, params });
			return respond(method);
		},
	}),
}));
const { useAppStore } = await import("../store");
const { RequestError } = actualTransport;
const { publishRepoWiki, startWikiBuild } = await import("./wikiActions");
const { useWikiPageState } = await import("./wikiPageState");
const { WikiPublishControl } = await import("./WikiPublishControl");
const initial = useAppStore.getInitialState();

beforeEach(() => {
	requests.length = 0;
	chats.length = 0;
	useAppStore.setState(initial, true);
	useWikiPageState.setState({ openFor: "ws1" });
});
afterAll(() => {
	mock.module("../transport", () => actualTransport);
	useAppStore.setState(initial, true);
	useWikiPageState.setState({ openFor: null });
});

test("a build asks the host for the prompt, leaves the page and opens a chat with it", async () => {
	respond = () => Promise.resolve({ prompt: "do the thing" });
	await startWikiBuild("ws1", { provider: "my-gateway", id: "llama-3" }, true, openChat);
	expect(requests).toEqual([
		{
			method: "wiki.prepareBuild",
			params: { workspaceId: "ws1", model: "my-gateway/llama-3", codeOnly: true },
		},
	]);
	expect(chats).toEqual([{ workspaceId: "ws1", prompt: "do the thing" }]);
	expect(useWikiPageState.getState().openFor).toBeNull();
});

test("a refused build keeps the page open, starts no chat and says why", async () => {
	respond = () => Promise.reject(new Error("Invalid model reference"));
	await startWikiBuild("ws1", { provider: "a", id: "b" }, false, openChat);
	expect(chats).toEqual([]);
	expect(useWikiPageState.getState().openFor).toBe("ws1");
	expect(useAppStore.getState().toasts.map((toast) => toast.message)).toEqual([
		"Invalid model reference",
	]);
});

test("a publish reports its address, and a branch that is not ours gets its own message", async () => {
	respond = () =>
		Promise.resolve({ url: "https://o.github.io/r/", branch: "gh-pages", pageCount: 3 });
	expect(await publishRepoWiki("ws1")).toBe(true);
	expect(useAppStore.getState().toasts[0]).toMatchObject({
		variant: "success",
		message: "https://o.github.io/r/",
	});

	respond = () =>
		Promise.reject(new RequestError("WIKI_BRANCH_FOREIGN", "Branch gh-pages already exists"));
	expect(await publishRepoWiki("ws1")).toBe(false);
	const failure = useAppStore.getState().toasts.at(-1);
	expect(failure?.variant).toBe("error");
	expect(failure?.message).toContain("Branch gh-pages already exists");
});

function publishMarkup(status: WikiStatus): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<WikiPublishControl workspaceId="ws1" status={status} onPublished={() => {}} />
		</TooltipProvider>,
	);
}

test("publishing is offered only for a built wiki with a GitHub origin", () => {
	const built: WikiStatus = {
		built: true,
		pages: [{ path: "index.md", title: "Index" }],
		publishTarget: "o/r",
	};
	expect(publishMarkup(built)).not.toContain(`disabled=""`);
	expect(publishMarkup(built)).toContain(String(EN["panels.wiki.publish.action"]));
	expect(publishMarkup({ ...built, publishTarget: null })).toContain(`disabled=""`);
	expect(publishMarkup({ ...built, built: false, pages: [] })).toContain(`disabled=""`);
	expect(
		publishMarkup({
			...built,
			publication: { url: "https://o.github.io/r/", branch: "gh-pages", publishedAt: 1 },
		}),
	).toContain(String(EN["panels.wiki.publish.sync"]));
});
