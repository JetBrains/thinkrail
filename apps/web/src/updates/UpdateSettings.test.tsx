import { expect, test } from "bun:test";
import type { HostUpdateNotice, NativeUpdateState } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateReadyButton } from "./UpdateReadyButton";
import { UpdateSettings } from "./UpdateSettings";
import type { UpdatesController } from "./useUpdates";

function nativeState(
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

function hostNotice(): HostUpdateNotice {
	return {
		currentVersion: "0.1.0",
		channel: "stable",
		availableVersion: "0.2.0",
	};
}

function nativeUpdates(
	state: NativeUpdateState | null,
	requestError: string | null = null,
): UpdatesController {
	return {
		source: "native",
		state,
		requestError,
		checkForUpdates: () => {},
		restartToUpdate: () => {},
	};
}

function hostUpdates(state: HostUpdateNotice): UpdatesController {
	return { source: "host", state };
}

function render(updates: UpdatesController): string {
	return renderToStaticMarkup(<UpdateSettings updates={updates} onLater={() => {}} />);
}

test("native ready updates retain direct restart and Later actions with installation identity", () => {
	const markup = render(
		nativeUpdates(nativeState("ready", { availableVersion: "0.1.0-nightly.46" })),
	);
	expect(markup).toContain("Restart to Update");
	expect(markup).toContain("Later");
	expect(markup).toContain("Version 0.1.0-nightly.45 · canary channel");
	expect(markup).toContain("Available: 0.1.0-nightly.46");
	expect(markup).not.toContain("Are you sure");
	expect(markup).toContain('data-testid="update-status"');
});

test("the native ready affordance remains a direct path back to update settings", () => {
	const markup = renderToStaticMarkup(
		<UpdateReadyButton
			updates={nativeUpdates(nativeState("ready", { availableVersion: "0.1.0-nightly.46" }))}
			onOpen={() => {}}
		/>,
	);
	expect(markup).toContain('data-testid="update-ready"');
	expect(markup).toContain('data-source="native"');
	expect(markup).toContain("Update ready");
	expect(markup).toContain("ThinkRail 0.1.0-nightly.46 is ready to install");
});

test("native download progress and request errors stay on the settings surface", () => {
	const downloading = render(
		nativeUpdates(
			nativeState("downloading", {
				availableVersion: "0.1.0-nightly.46",
				progress: 42,
			}),
		),
	);
	expect(downloading).toContain('value="42"');
	expect(downloading).toContain("Downloading update — 42%");

	const failed = render(nativeUpdates(nativeState("idle"), "The update request timed out"));
	expect(failed).toContain("Retry");
	expect(failed).toContain('role="alert"');
	expect(failed).toContain("The update request timed out");
});

test("an error on retained native ready state stays visible and offers retry and restart", () => {
	const markup = render(
		nativeUpdates(
			nativeState("ready", {
				availableVersion: "0.1.0-nightly.46",
				error: "The pre-restart check failed",
			}),
		),
	);
	expect(markup).toContain("The pre-restart check failed");
	expect(markup).toContain("Retry");
	expect(markup).toContain("Restart to Update");
});

test("a host notice shows immutable release details and fixed machine guidance only", () => {
	const markup = render(hostUpdates(hostNotice()));
	expect(markup).toContain("ThinkRail 0.2.0 is available");
	expect(markup).toContain("Current: 0.1.0 · stable channel");
	expect(markup).toContain("Available: 0.2.0");
	expect(markup).toContain("thinkrail update");
	expect(markup).toContain("on the machine running the host, then restart ThinkRail");
	expect(markup).toContain('data-source="host"');
	expect(markup).not.toContain("Check for Updates");
	expect(markup).not.toContain("Retry");
	expect(markup).not.toContain("Later");
	expect(markup).not.toContain("Restart to Update");
	expect(markup).not.toContain("<progress");
});

test("a host notice always exposes the shared Update available affordance", () => {
	const markup = renderToStaticMarkup(
		<UpdateReadyButton updates={hostUpdates(hostNotice())} onOpen={() => {}} />,
	);
	expect(markup).toContain('data-testid="update-ready"');
	expect(markup).toContain('data-source="host"');
	expect(markup).toContain("Update available");
	expect(markup).toContain("ThinkRail 0.2.0 is available");
});
