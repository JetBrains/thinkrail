import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, expect, type Page, test } from "@playwright/test";
import type { ToolResponsePendingDetails } from "@thinkrail/contracts";
import { openFixtureProject, PHONE_VIEWPORT } from "./fixtures/app";
import { resolveBunExecutable } from "./fixtures/executables";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const webDir = fileURLToPath(new URL("../apps/web", import.meta.url));
const phoneDir = join(webDir, "dist-phone");
const BASE_TS = 1_700_900_000_000;
const TYPES: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
};

test.use({
	launchOptions: { args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] },
});

let server: Server;
let phoneUrl: string;

test.beforeAll(async () => {
	test.setTimeout(180_000);
	const build = spawnSync(resolveBunExecutable(), ["run", "build:phone"], {
		cwd: webDir,
		stdio: "inherit",
	});
	if (build.status !== 0 || !existsSync(join(phoneDir, "index.html")))
		throw new Error("the phone shell did not build");
	server = createServer((request, response) => {
		const path = normalize(new URL(request.url ?? "/", "http://phone").pathname);
		const file = join(phoneDir, path === "/" ? "index.html" : path);
		if (!file.startsWith(phoneDir) || !existsSync(file)) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
		response.end(readFileSync(file));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	phoneUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

test.afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

function hostRequest(
	page: Page,
	method: string,
	params: Record<string, unknown>,
): Promise<unknown> {
	return page.evaluate(
		async ({ method, params }) => {
			const ws = new WebSocket(`ws://${location.host}/ws`);
			await new Promise((resolve) => {
				ws.onopen = resolve;
			});
			const id = `phone_${Math.random()}`;
			const result = await new Promise<unknown>((resolve, reject) => {
				ws.addEventListener("message", (event) => {
					const message = JSON.parse(event.data as string);
					if (message.id !== id) return;
					if (message.ok) resolve(message.result);
					else reject(new Error(message.error));
				});
				ws.send(JSON.stringify({ id, method, params }));
			});
			ws.close();
			return result;
		},
		{ method, params },
	);
}

async function onPhone(
	page: Page,
	browser: Browser,
	drive: (phone: Page) => Promise<void>,
): Promise<void> {
	await hostRequest(page, "remote.setEnabled", { enabled: true });
	const phoneContext = await browser.newContext({ viewport: PHONE_VIEWPORT });
	try {
		const { link } = (await hostRequest(page, "remote.issueLink", {})) as { link: string };
		const phone = await phoneContext.newPage();
		await phone.goto(phoneUrl);
		await phone.getByRole("button", { name: "Enter link manually" }).click();
		await phone.getByRole("textbox", { name: "Pairing link" }).fill(link);
		await phone.getByRole("button", { name: "Connect" }).click();
		await expect(phone.getByTestId("computer")).toContainText("Connected", { timeout: 30_000 });
		await phone.getByRole("button", { name: /^sample-project/ }).click();
		await phone.getByRole("button", { name: /^Default / }).click();
		await drive(phone);
	} finally {
		await phoneContext.close();
		await hostRequest(page, "remote.setEnabled", { enabled: false });
	}
}

test("a phone pairs by link, finds the project on the computer and reads its chat from the store", async ({
	page,
	browser,
}) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		id: "e2e-phone-shell-chat",
		messages: [
			{ role: "user", text: "summarize the phone shell move", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "The phone now runs on the same store as the IDE.",
				timestamp: BASE_TS + 1_000,
			},
		],
	});
	await onPhone(page, browser, async (phone) => {
		await expect(phone.getByText("The phone now runs on the same store as the IDE.")).toBeVisible({
			timeout: 30_000,
		});
		await expect(phone.getByTestId("user-message-body")).toHaveText(
			"summarize the phone shell move",
		);
		await expect(phone.getByTestId("model-selector")).toBeVisible();
	});
});

test("a question the agent waits on shows on the phone as the IDE's question card", async ({
	page,
	browser,
}) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	const ack: ToolResponsePendingDetails = { kind: "ack" };
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		id: "e2e-phone-shell-question",
		messages: [
			{ role: "user", text: "pick a database for me", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "phone-ask",
						name: "ask_user_question",
						arguments: {
							questions: [
								{
									question: "Which database should the phone use?",
									header: "Database",
									options: [
										{ label: "Postgres", description: "Relational" },
										{ label: "SQLite", description: "Embedded" },
									],
								},
							],
						},
					},
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "phone-ask",
				toolName: "ask_user_question",
				content: [{ type: "text", text: "Questions shown to the user; awaiting an answer." }],
				details: ack,
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	await onPhone(page, browser, async (phone) => {
		await expect(phone.getByText("Which database should the phone use?")).toBeVisible({
			timeout: 30_000,
		});
		await expect(phone.getByText("Postgres")).toBeVisible();
		await expect(phone.getByText("SQLite")).toBeVisible();
	});
});
