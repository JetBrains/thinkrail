import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { installRepoExtension, reloadExtension, removeExtension } from "./fixtures/extensions";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const GROUP = "extension-test-runner";
const EXTENSION = "test-runner";
const TESTS_DIR = join(E2E_FIXTURE_REPO, "tr-tests");
const BASE_TS = 1_700_900_000_000;

const MATH = `import { describe, expect, test } from "bun:test";
describe("cart", () => {
	test("adds items", () => expect([1, 2].length).toBe(2));
	test("applies the discount", () => expect({ total: 90 }).toEqual({ total: 80 }));
	test.skip("ships abroad", () => {});
});
test("parses the price", () => {
	throw new Error("unexpected token in price: '12,5'");
});
`;

const OK = `import { expect, test } from "bun:test";
test("formats money", () => expect((12.5).toFixed(2)).toBe("12.50"));
`;

const SLOW = `import { test } from "bun:test";
test("waits for a slow service", async () => {
	await Bun.sleep(60_000);
}, 120_000);
`;

const writeTests = () => {
	mkdirSync(TESTS_DIR, { recursive: true });
	writeFileSync(join(TESTS_DIR, "cart.test.ts"), MATH);
	writeFileSync(join(TESTS_DIR, "money.test.ts"), OK);
};

const TOOL_DETAILS = {
	command: "bun test cart",
	filter: "cart",
	by: "agent",
	startedAt: BASE_TS + 1_000,
	durationMs: 412,
	outcome: "failed",
	exitCode: 1,
	source: "junit",
	counts: { pass: 1, fail: 2, skip: 1 },
	failures: [
		{
			name: "cart > applies the discount",
			file: "tr-tests/cart.test.ts",
			line: 4,
			error: "AssertionError: expect(received).toEqual(expected)",
		},
		{
			name: "parses the price",
			file: "tr-tests/cart.test.ts",
			line: 7,
			error: "Error: unexpected token in price: '12,5'",
		},
	],
	failuresTotal: 2,
	output: "",
};

const seedChat = () =>
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "tests chat",
		messages: [
			{ role: "user", text: "Run the cart tests", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "tests-1", name: "run_tests", arguments: { filter: "cart" } },
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "tests-1",
				toolName: "run_tests",
				content: [{ type: "text", text: "Failed: 1 passed, 2 failed, 1 skipped in 412ms." }],
				details: TOOL_DETAILS,
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});

const openPanel = async (page: Page) => {
	await page.getByTestId("ext-menu").first().click();
	await page.getByTestId(`ext-open-${EXTENSION}-runner`).click();
	return page.getByTestId("test-runner");
};

test.use({ viewport: { width: 1600, height: 1000 } });

test.afterEach(async () => {
	await removeExtension(EXTENSION);
	rmSync(TESTS_DIR, { recursive: true, force: true });
});

test("test-runner runs, filters, cancels, and hands a failure to a new chat", async ({ page }) => {
	await openFixtureProject(page);
	writeTests();
	await enterDefaultWorkspace(page);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");

	const panel = await openPanel(page);
	await expect(panel).toHaveAttribute("data-state", "idle");
	await expect(panel.getByTestId("test-runner-label")).toHaveText("bun test");
	await shot(panel, GROUP, "10-test-runner-empty");

	await panel.getByTestId("test-runner-run").click();
	await expect(panel).toHaveAttribute("data-state", "failed", { timeout: 30_000 });
	await expect(panel.getByTestId("test-runner-count-pass")).toContainText("2");
	await expect(panel.getByTestId("test-runner-count-fail")).toContainText("2");
	await expect(panel.getByTestId("test-runner-count-skip")).toContainText("1");
	const failures = panel.getByTestId("test-runner-failure");
	await expect(failures).toHaveCount(2);
	await expect(failures.filter({ hasText: "cart > applies the discount" })).toContainText(
		"tr-tests/cart.test.ts:4",
	);
	await expect(failures.filter({ hasText: "parses the price" })).toContainText(
		"unexpected token in price",
	);
	await shot(panel, GROUP, "10-test-runner-failed");

	const filter = panel.getByTestId("test-runner-filter");
	await filter.fill("money");
	await filter.press("Enter");
	await expect(panel).toHaveAttribute("data-state", "passed", { timeout: 30_000 });
	await expect(panel.getByTestId("test-runner-count-pass")).toContainText("1");
	await expect(panel.getByTestId("test-runner-failure")).toHaveCount(0);
	await shot(panel, GROUP, "10-test-runner-passed");

	writeFileSync(join(TESTS_DIR, "slow.test.ts"), SLOW);
	await filter.fill("slow");
	await panel.getByTestId("test-runner-run").click();
	await expect(panel).toHaveAttribute("data-state", "running");
	await expect(panel.getByTestId("test-runner-running")).toContainText("bun test slow");
	await shot(panel, GROUP, "10-test-runner-running");
	await panel.getByTestId("test-runner-cancel").click();
	await expect(panel).toHaveAttribute("data-state", "cancelled", { timeout: 15_000 });
	rmSync(join(TESTS_DIR, "slow.test.ts"), { force: true });

	await filter.fill("cart");
	await panel.getByTestId("test-runner-run").click();
	await expect(panel).toHaveAttribute("data-state", "failed", { timeout: 30_000 });
	await panel.getByTestId("test-runner-fix").first().click();
	await expect(page.getByTestId("chat-input")).toHaveValue(/The test ".+" fails in tr-tests\/cart/);
	await expect(page.getByTestId("chat-input")).toHaveValue(/run_tests with filter/);
	await shot(page, GROUP, "10-test-runner-app");
});

test("the run_tests tool card renders from a seeded transcript", async ({ page }) => {
	await openFixtureProject(page);
	seedChat();
	await enterDefaultWorkspace(page);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");
	await openPersistedChat(page, "tests chat");

	const card = page.getByTestId("test-runner-tool");
	await expect(card).toHaveAttribute("data-state", "failed");
	await expect(card).toContainText("cart");
	await expect(card.getByTestId("test-runner-tool-failure")).toHaveCount(2);
	await expect(card.getByTestId("test-runner-count-fail")).toContainText("2");
	await shot(card, GROUP, "10-test-runner-tool-card");

	await card.getByTestId("test-runner-tool-open").click();
	await expect(page.getByTestId("test-runner")).toBeVisible();
});
