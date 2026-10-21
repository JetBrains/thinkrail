import { expect, type Page, test } from "@playwright/test";
import type {
	NativeUpdateBridge,
	NativeUpdateInstallResult,
	NativeUpdateState,
} from "@thinkrail/contracts";
import { openAppFresh } from "./fixtures/app";

type TestGlobals = typeof globalThis & {
	__THINKRAIL_TEST_UPDATE__: (next: Partial<NativeUpdateState>) => void;
	__THINKRAIL_TEST_CALLS__: string[];
};

async function installFakeBridge(page: Page, initial: Partial<NativeUpdateState>): Promise<void> {
	await page.addInitScript((overrides) => {
		let state: NativeUpdateState = {
			revision: 1,
			status: "ready",
			version: "0.3.0-nightly.1",
			channel: "canary",
			availableVersion: "0.3.0-nightly.4",
			progress: 100,
			error: null,
			failedPhase: null,
			installStep: null,
			log: [],
			lastInstall: null,
			...overrides,
		};
		const calls: string[] = [];
		const listeners = new Set<(next: NativeUpdateState) => void>();
		const publish = (next: Partial<NativeUpdateState>) => {
			state = { ...state, ...next, revision: state.revision + 1 };
			for (const listener of listeners) listener(state);
		};
		const bridge: NativeUpdateBridge = {
			getState: async () => state,
			checkForUpdates: async () => {
				calls.push("check");
				publish({ status: "checking" });
			},
			downloadUpdate: async () => {
				calls.push("download");
			},
			restartToUpdate: async () => {
				calls.push("install");
				publish({
					status: "installing",
					installStep: "stopping",
					lastInstall: null,
					log: [
						{
							at: Date.now(),
							source: "update",
							level: "info",
							text: "Installing ThinkRail 0.3.0-nightly.4",
						},
						{
							at: Date.now(),
							source: "host",
							level: "info",
							text: "Stopping agents and terminals",
						},
					],
				});
			},
			dismissInstallResult: async () => {
				calls.push("dismiss");
				publish({ lastInstall: null });
			},
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		Object.defineProperty(globalThis, "__THINKRAIL_NATIVE_UPDATES__", { value: bridge });
		Object.defineProperty(globalThis, "__THINKRAIL_TEST_UPDATE__", { value: publish });
		Object.defineProperty(globalThis, "__THINKRAIL_TEST_CALLS__", { value: calls });
	}, initial);
}

async function publish(page: Page, next: Partial<NativeUpdateState>): Promise<void> {
	await page.evaluate(
		(patch) => (globalThis as TestGlobals).__THINKRAIL_TEST_UPDATE__(patch),
		next,
	);
}

async function bridgeCalls(page: Page): Promise<string[]> {
	return page.evaluate(() => [...(globalThis as TestGlobals).__THINKRAIL_TEST_CALLS__]);
}

const failedSwap: NativeUpdateInstallResult = {
	outcome: "failed",
	fromVersion: "0.3.0-nightly.1",
	toVersion: "0.3.0-nightly.4",
	failedStep: "swapping",
	detail: "AccessDenied",
	log: [
		{
			at: 1_760_000_000_000,
			source: "update",
			level: "info",
			text: "Update prepared; restarting application...",
		},
		{
			at: 1_760_000_030_000,
			source: "installer",
			level: "error",
			text: "Update to 0.3.0-nightly.4 failed during swapping: AccessDenied",
		},
	],
};

test("Install & Restart shows a non-dismissable installer with steps and a log until it ends", async ({
	page,
}) => {
	await installFakeBridge(page, {});
	await openAppFresh(page);
	await page.getByTestId("update-ready").click();
	await page.getByTestId("update-restart").click();

	const dialog = page.getByTestId("update-install-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Installing ThinkRail 0.3.0-nightly.4");
	await expect(dialog).toContainText("ThinkRail will close and reopen by itself");
	const step = (key: string) => dialog.locator(`[data-step="${key}"]`);
	await expect(step("prepared")).toHaveAttribute("data-status", "done");
	await expect(step("stopping")).toHaveAttribute("data-status", "active");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeVisible();
	await page.getByTestId("update-log-toggle").click();
	await expect(page.getByTestId("update-log")).toContainText("Stopping agents and terminals");

	await publish(page, { installStep: "handoff" });
	await expect(step("stopping")).toHaveAttribute("data-status", "done");
	await expect(step("handoff")).toHaveAttribute("data-status", "active");

	await publish(page, {
		status: "error",
		failedPhase: "install",
		installStep: null,
		error: "Failed to start update helper: denied",
	});
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("update-error")).toContainText("Failed to start update helper");
});

test("a failed install after relaunch explains the cause, offers recovery, and dismisses", async ({
	page,
}) => {
	await installFakeBridge(page, { lastInstall: failedSwap });
	await openAppFresh(page);

	const dialog = page.getByTestId("update-install-failed");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("The update didn't install");
	await expect(dialog).toContainText("restored version 0.3.0-nightly.1");
	await expect(page.getByTestId("update-install-cause")).toHaveText(
		"Another program is using ThinkRail's install folder",
	);
	await expect(page.getByTestId("update-ready")).toContainText("Update didn't install");
	const recover = page.getByTestId("update-install-recover");
	await expect(recover).toHaveAttribute("data-recovery", "install");
	await expect(recover).toHaveText("Try again");

	await page.getByTestId("update-log-toggle").click();
	await expect(page.getByTestId("update-log")).toContainText(
		"failed during swapping: AccessDenied",
	);

	await publish(page, { status: "idle", availableVersion: null });
	await expect(recover).toHaveText("Check again");
	await recover.click();
	await expect(recover).toBeDisabled();
	await expect(recover).toHaveText("Checking for updates…");

	await page.getByTestId("update-install-later").click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("update-ready")).toBeHidden();
	expect(await bridgeCalls(page)).toEqual(["check", "dismiss"]);
});

test("Try again from the failure dialog starts a new install attempt", async ({ page }) => {
	await installFakeBridge(page, { lastInstall: failedSwap });
	await openAppFresh(page);
	await page.getByTestId("update-install-recover").click();
	await expect(page.getByTestId("update-install-failed")).toBeHidden();
	await expect(page.getByTestId("update-install-dialog")).toBeVisible();
	expect(await bridgeCalls(page)).toEqual(["install"]);
});

test("a successful install after relaunch toasts once and keeps Details from the snapshot", async ({
	page,
}) => {
	await installFakeBridge(page, {
		status: "idle",
		version: "0.3.0-nightly.4",
		availableVersion: null,
		lastInstall: {
			outcome: "installed",
			fromVersion: "0.3.0-nightly.1",
			toVersion: "0.3.0-nightly.4",
			failedStep: null,
			detail: null,
			log: [failedSwap.log[0] as NativeUpdateInstallResult["log"][number]],
		},
	});
	await openAppFresh(page);

	const toast = page.getByTestId("toast").filter({ hasText: "Updated to 0.3.0-nightly.4" });
	await expect(toast).toHaveCount(1);
	await expect(toast).toContainText("from 0.3.0-nightly.1");
	await expect.poll(() => bridgeCalls(page)).toEqual(["dismiss"]);
	await toast.getByRole("button", { name: "Details" }).click();
	const details = page.getByTestId("update-install-details");
	await expect(details).toContainText("ThinkRail 0.3.0-nightly.4 is installed");
	await expect(details.getByRole("link", { name: "What's new" })).toHaveAttribute(
		"href",
		"https://github.com/JetBrains/thinkrail/releases/tag/v0.3.0-nightly.4",
	);
	await expect(page.getByTestId("update-log")).toContainText("Update prepared");
});
