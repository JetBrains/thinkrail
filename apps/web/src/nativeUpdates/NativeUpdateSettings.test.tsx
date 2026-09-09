import { expect, test } from "bun:test";
import type { NativeUpdateState } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { NativeUpdateReadyButtonView } from "./NativeUpdateReadyButton";
import { NativeUpdateSettingsView } from "./NativeUpdateSettings";
import { deriveNativeUpdatePresentation } from "./presentation";

function render(state: NativeUpdateState, actionError: string | null = null): string {
	return renderToStaticMarkup(
		<NativeUpdateSettingsView
			presentation={deriveNativeUpdatePresentation({
				state,
				pendingAction: null,
				actionError,
			})}
			onCheck={() => {}}
			onRestart={() => {}}
			onLater={() => {}}
		/>,
	);
}

function state(
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

test("ready updates expose direct restart and Later actions with installation identity", () => {
	const markup = render(state("ready", { availableVersion: "0.1.0-nightly.46" }));
	expect(markup).toContain("Restart to Update");
	expect(markup).toContain("Later");
	expect(markup).toContain("Version 0.1.0-nightly.45 · canary channel");
	expect(markup).toContain("Available: 0.1.0-nightly.46");
	expect(markup).not.toContain("Are you sure");
});

test("the ready affordance remains a direct path back to update settings", () => {
	const markup = renderToStaticMarkup(
		<NativeUpdateReadyButtonView version="0.1.0-nightly.46" onOpen={() => {}} />,
	);
	expect(markup).toContain('data-testid="native-update-ready"');
	expect(markup).toContain("Update ready");
	expect(markup).toContain("ThinkRail 0.1.0-nightly.46 is ready to install");
});

test("download progress and retry errors stay on the shared settings surface", () => {
	const downloading = render(
		state("downloading", { availableVersion: "0.1.0-nightly.46", progress: 42 }),
	);
	expect(downloading).toContain('value="42"');
	expect(downloading).toContain("Downloading update — 42%");

	const failed = render(state("error", { error: "The update feed is offline" }));
	expect(failed).toContain("Retry");
	expect(failed).toContain('role="alert"');
	expect(failed).toContain("The update feed is offline");
});
