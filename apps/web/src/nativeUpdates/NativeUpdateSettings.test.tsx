import { expect, test } from "bun:test";
import type { NativeUpdateState } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { NativeUpdateReadyButton } from "./NativeUpdateReadyButton";
import { NativeUpdateSettings } from "./NativeUpdateSettings";

function updateState(
	status: NativeUpdateState["status"],
	overrides: Partial<NativeUpdateState> = {},
): NativeUpdateState {
	return {
		revision: 4,
		status,
		version: "0.1.0-nightly.45",
		channel: "canary",
		availableVersion: null,
		progress: null,
		error: null,
		...overrides,
	};
}

function render(state: NativeUpdateState | null, requestError: string | null = null): string {
	return renderToStaticMarkup(
		<NativeUpdateSettings
			state={state}
			requestError={requestError}
			onCheck={() => {}}
			onRestart={() => {}}
			onLater={() => {}}
		/>,
	);
}

test("ready updates expose direct restart and Later actions with installation identity", () => {
	const markup = render(updateState("ready", { availableVersion: "0.1.0-nightly.46" }));
	expect(markup).toContain("Restart to Update");
	expect(markup).toContain("Later");
	expect(markup).toContain("Version 0.1.0-nightly.45 · canary channel");
	expect(markup).toContain("Available: 0.1.0-nightly.46");
	expect(markup).not.toContain("Are you sure");
});

test("the ready affordance remains a direct path back to update settings", () => {
	const markup = renderToStaticMarkup(
		<NativeUpdateReadyButton
			state={updateState("ready", { availableVersion: "0.1.0-nightly.46" })}
			onOpen={() => {}}
		/>,
	);
	expect(markup).toContain('data-testid="native-update-ready"');
	expect(markup).toContain("Update ready");
	expect(markup).toContain("ThinkRail 0.1.0-nightly.46 is ready to install");
});

test("download progress and request errors stay on the settings surface", () => {
	const downloading = render(
		updateState("downloading", {
			availableVersion: "0.1.0-nightly.46",
			progress: 42,
		}),
	);
	expect(downloading).toContain('value="42"');
	expect(downloading).toContain("Downloading update — 42%");

	const failed = render(updateState("idle"), "The update request timed out");
	expect(failed).toContain("Retry");
	expect(failed).toContain('role="alert"');
	expect(failed).toContain("The update request timed out");
});

test("an error on retained ready state stays visible and offers retry and restart", () => {
	const markup = render(
		updateState("ready", {
			availableVersion: "0.1.0-nightly.46",
			error: "The pre-restart check failed",
		}),
	);
	expect(markup).toContain("The pre-restart check failed");
	expect(markup).toContain("Retry");
	expect(markup).toContain("Restart to Update");
});
