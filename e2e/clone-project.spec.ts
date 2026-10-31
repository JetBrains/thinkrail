import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { PROJECT_CLONE_PROTOCOL_VERSION, type WsParams } from "@thinkrail/contracts";
import { openAppFresh } from "./fixtures/app";
import { commitFile, git, gitText } from "./fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PICK_DIR_POINTER } from "./fixtures/paths";

function parseFrame(message: string | Buffer): Record<string, unknown> {
	return JSON.parse(message.toString()) as Record<string, unknown>;
}

async function openCloneDialog(page: Page, entry: "welcome" | "rail" = "rail") {
	await openAppFresh(page);
	if (entry === "welcome") {
		await page.getByTestId("welcome-action").filter({ hasText: "Open project" }).click();
	} else {
		await page.getByTestId("add-project-menu").click();
	}
	await page.getByTestId("menu-clone-project").click();
	const dialog = page.getByTestId("clone-project-dialog");
	await expect(dialog).toBeVisible();
	return dialog;
}

function seedRepository(root: string) {
	const source = join(root, "source.git");
	mkdirSync(source);
	git(source, "init", "-b", "main");
	git(source, "config", "commit.gpgsign", "false");
	commitFile(source, "README.md", "# Local clone fixture\n", "initial fixture");
	commitFile(source, "history.txt", "older revision\n", "second revision");
	const head = commitFile(source, "history.txt", "latest revision\n", "latest revision");
	const parent = join(root, "clones");
	mkdirSync(parent);
	return { source, parent, head, url: pathToFileURL(source).href };
}

let root: string;

test.beforeEach(() => {
	root = realpathSync(mkdtempSync(join(E2E_DATA_DIR, "clone-project-")));
});

test.afterEach(() => {
	writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
	rmSync(root, { recursive: true, force: true });
});

test("Welcome clones a local repository at depth 1 and opens Project Home without an agent", async ({
	page,
}) => {
	const fixture = seedRepository(root);
	const agentRequests: string[] = [];
	let cloneParams: WsParams<"project.clone"> | undefined;
	await page.routeWebSocket(/\/ws(?:\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = parseFrame(message);
			if (frame.method === "project.clone") cloneParams = frame.params as WsParams<"project.clone">;
			if (frame.method === "session.create" || frame.method === "session.prompt") {
				agentRequests.push(frame.method);
			}
			server.send(message);
		});
	});
	const dialog = await openCloneDialog(page, "welcome");
	await expect(dialog.getByTestId("clone-project-parent")).toHaveValue("~");
	await expect(dialog.getByTestId("clone-project-submit")).toBeDisabled();
	await dialog.getByTestId("clone-project-url").fill(fixture.url);
	await expect(dialog.getByTestId("clone-project-name")).toHaveValue("source");
	await dialog.getByTestId("clone-project-parent").fill(fixture.parent);
	await dialog.getByTestId("clone-project-depth").fill("1");
	const destination = join(fixture.parent, "source");
	await expect(dialog.getByTestId("clone-project-path")).toHaveText(destination);
	await dialog.getByTestId("clone-project-submit").click();

	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("welcome-title")).toHaveText("source");
	await expect(page.getByTestId("project-name")).toHaveText("source");
	await expect(
		page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }),
	).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	expect(agentRequests).toEqual([]);
	expect(cloneParams).toMatchObject({
		url: fixture.url,
		parentPath: fixture.parent,
		name: "source",
		depth: 1,
	});
	expect(readFileSync(join(destination, "README.md"), "utf8")).toBe("# Local clone fixture\n");
	expect(readFileSync(join(destination, "history.txt"), "utf8")).toBe("latest revision\n");
	expect(gitText(destination, "rev-parse", "HEAD").trim()).toBe(fixture.head);
	expect(gitText(destination, "rev-list", "--count", "HEAD").trim()).toBe("1");
	expect(gitText(destination, "rev-parse", "--is-shallow-repository").trim()).toBe("true");
	expect(gitText(fixture.source, "rev-list", "--count", "HEAD").trim()).toBe("3");
});

test("an existing destination is rejected without deleting its files", async ({ page }) => {
	const fixture = seedRepository(root);
	const destination = join(fixture.parent, "source");
	mkdirSync(destination);
	writeFileSync(join(destination, "keep.txt"), "Do not delete this existing directory.\n");
	const dialog = await openCloneDialog(page);
	await dialog.getByTestId("clone-project-url").fill(fixture.url);
	await dialog.getByTestId("clone-project-parent").fill(fixture.parent);
	await expect(dialog.getByTestId("clone-project-destination-error")).toBeVisible();
	await expect(dialog.getByTestId("clone-project-submit")).toBeDisabled();
	await dialog.getByTestId("clone-project-cancel").click();
	await expect(dialog).toHaveCount(0);
	expect(readFileSync(join(destination, "keep.txt"), "utf8")).toBe(
		"Do not delete this existing directory.\n",
	);
	expect(existsSync(join(destination, ".git"))).toBe(false);
	await expect(page.getByTestId("project-item")).toHaveCount(0);
});

test("an invalid repository URL fails and can be corrected and retried in the same dialog", async ({
	page,
}) => {
	const fixture = seedRepository(root);
	const dialog = await openCloneDialog(page);
	await dialog.getByTestId("clone-project-parent").fill(fixture.parent);
	await dialog.getByTestId("clone-project-url").fill("not a repository URL");
	await dialog.getByTestId("clone-project-name").fill("retry-clone");
	const destination = join(fixture.parent, "retry-clone");
	await expect(dialog.getByTestId("clone-project-path")).toHaveText(destination);
	await dialog.getByTestId("clone-project-submit").click();
	await expect(dialog.getByTestId("clone-project-error")).toBeVisible();
	await expect(dialog.getByTestId("clone-project-url")).toBeEnabled();
	await expect(dialog.getByTestId("clone-project-submit")).toBeEnabled();
	expect(existsSync(destination)).toBe(false);
	await expect(page.getByTestId("project-item")).toHaveCount(0);

	await dialog.getByTestId("clone-project-url").fill(fixture.url);
	await expect(dialog.getByTestId("clone-project-name")).toHaveValue("retry-clone");
	await dialog.getByTestId("clone-project-submit").click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("welcome-title")).toHaveText("retry-clone");
	expect(gitText(destination, "rev-list", "--count", "HEAD").trim()).toBe("3");
	expect(gitText(destination, "rev-parse", "--is-shallow-repository").trim()).toBe("false");
});

test("the parent picker and manual name wait for the host destination reply before submission", async ({
	page,
}) => {
	const fixture = seedRepository(root);
	let heldReply: (() => void) | undefined;
	await page.routeWebSocket(/\/ws(?:\?|$)/, (browser) => {
		const server = browser.connectToServer();
		let destinationRequestId: unknown;
		browser.onMessage((message) => {
			const frame = parseFrame(message);
			if (frame.method === "project.cloneDestination") {
				const params = frame.params as WsParams<"project.cloneDestination">;
				if (params.parentPath === fixture.parent && params.name === "chosen-name")
					destinationRequestId = frame.id;
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = parseFrame(message);
			if (destinationRequestId !== undefined && frame.id === destinationRequestId) {
				heldReply = () => browser.send(message);
				return;
			}
			browser.send(message);
		});
	});
	const dialog = await openCloneDialog(page);
	writeFileSync(E2E_PICK_DIR_POINTER, fixture.parent);
	await dialog.getByTestId("clone-project-url").fill(pathToFileURL(join(root, "other.git")).href);
	await expect(dialog.getByTestId("clone-project-name")).toHaveValue("other");
	await dialog.getByTestId("clone-project-name").fill("chosen-name");
	await dialog.getByTestId("clone-project-url").fill(fixture.url);
	await expect(dialog.getByTestId("clone-project-name")).toHaveValue("chosen-name");
	await dialog.getByTestId("clone-project-browse").click();
	await expect(dialog.getByTestId("clone-project-parent")).toHaveValue(fixture.parent);
	await expect.poll(() => heldReply !== undefined).toBe(true);
	await expect(dialog.getByTestId("clone-project-submit")).toBeDisabled();
	const destination = join(fixture.parent, "chosen-name");
	await expect(dialog.getByTestId("clone-project-path")).not.toHaveText(destination);
	if (!heldReply) throw new Error("Missing held destination reply");
	heldReply();
	await expect(dialog.getByTestId("clone-project-path")).toHaveText(destination);
	await expect(dialog.getByTestId("clone-project-submit")).toBeEnabled();
	await dialog.getByTestId("clone-project-submit").click();
	await expect(page.getByTestId("welcome-title")).toHaveText("chosen-name");
	expect(gitText(destination, "rev-parse", "HEAD").trim()).toBe(fixture.head);
});

test("hosts before protocol 95 hide cloning in both project menus", async ({ page }) => {
	const cloneRequests: unknown[] = [];
	await page.routeWebSocket(/\/ws(?:\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = parseFrame(message);
			if (frame.method === "project.clone" || frame.method === "project.cloneDestination")
				cloneRequests.push(frame);
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = parseFrame(message);
			if (frame.channel === "server.welcome") {
				browser.send(
					JSON.stringify({
						...frame,
						data: {
							...(frame.data as Record<string, unknown>),
							protocolVersion: PROJECT_CLONE_PROTOCOL_VERSION - 1,
						},
					}),
				);
			} else {
				browser.send(message);
			}
		});
	});
	await openAppFresh(page);
	await page.getByTestId("welcome-action").filter({ hasText: "Open project" }).click();
	await expect(page.getByTestId("menu-open-project")).toBeVisible();
	await expect(page.getByTestId("menu-clone-project")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.getByTestId("add-project-menu").click();
	await expect(page.getByTestId("menu-open-project")).toBeVisible();
	await expect(page.getByTestId("menu-clone-project")).toHaveCount(0);
	expect(cloneRequests).toEqual([]);
});

test("cancel UI keeps fields busy after acknowledgement until the simulated null clone reply", async ({
	page,
}) => {
	test.info().annotations.push({
		type: "coverage",
		description:
			"UI-only wire simulation; real Git process cancellation and cleanup are covered by server unit tests.",
	});
	const fixture = seedRepository(root);
	let cloneParams: WsParams<"project.clone"> | undefined;
	let cancelParams: WsParams<"project.cancelClone"> | undefined;
	let cancelAcknowledged = false;
	let completeClone: (() => void) | undefined;
	await page.routeWebSocket(/\/ws(?:\?|$)/, (browser) => {
		const server = browser.connectToServer();
		let cancelRequestId: unknown;
		browser.onMessage((message) => {
			const frame = parseFrame(message);
			if (frame.method === "project.clone") {
				cloneParams = frame.params as WsParams<"project.clone">;
				completeClone = () =>
					browser.send(JSON.stringify({ id: frame.id, ok: true, result: null }));
				return;
			}
			if (frame.method === "project.cancelClone") {
				cancelParams = frame.params as WsParams<"project.cancelClone">;
				cancelRequestId = frame.id;
				browser.send(JSON.stringify({ id: frame.id, ok: true, result: { ok: true } }));
				return;
			}
			if (
				cancelRequestId !== undefined &&
				Array.isArray(frame.ack) &&
				frame.ack.includes(cancelRequestId)
			)
				cancelAcknowledged = true;
			server.send(message);
		});
	});
	const dialog = await openCloneDialog(page);
	await dialog.getByTestId("clone-project-url").fill(fixture.url);
	await dialog.getByTestId("clone-project-parent").fill(fixture.parent);
	await expect(dialog.getByTestId("clone-project-submit")).toBeEnabled();
	await dialog.getByTestId("clone-project-submit").click();
	await expect.poll(() => cloneParams?.operationId).toBeTruthy();
	for (const field of ["url", "parent", "name", "depth", "browse", "submit"]) {
		await expect(dialog.getByTestId(`clone-project-${field}`)).toBeDisabled();
	}
	await page.keyboard.press("Escape");
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("clone-project-cancel").click();
	await expect.poll(() => cancelAcknowledged).toBe(true);
	expect(cancelParams?.operationId).toBe(cloneParams?.operationId);
	await expect(dialog.getByTestId("clone-project-status")).toContainText("Stopping Git");
	for (const field of ["url", "parent", "name", "depth", "browse", "submit", "cancel"]) {
		await expect(dialog.getByTestId(`clone-project-${field}`)).toBeDisabled();
	}
	await page.keyboard.press("Escape");
	await expect(dialog).toBeVisible();
	if (!completeClone) throw new Error("Missing intercepted clone request");
	completeClone();
	await expect(dialog.getByTestId("clone-project-status")).toContainText("Clone cancelled");
	for (const field of ["url", "parent", "name", "depth", "browse", "submit", "cancel"]) {
		await expect(dialog.getByTestId(`clone-project-${field}`)).toBeEnabled();
	}
	await expect(page.getByTestId("project-item")).toHaveCount(0);
	expect(existsSync(join(fixture.parent, "source"))).toBe(false);
	await dialog.getByTestId("clone-project-name").fill("try-again");
	await expect(dialog.getByTestId("clone-project-path")).toHaveText(
		join(fixture.parent, "try-again"),
	);
	await dialog.getByTestId("clone-project-cancel").click();
	await expect(dialog).toHaveCount(0);
});
