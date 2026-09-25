import { expect, test } from "bun:test";
import type { HostUpdateNotice, NativeUpdateState } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateReadyButton } from "./UpdateReadyButton";
import { UpdateSettings } from "./UpdateSettings";
import type { NativeUpdateRequestError, UpdatesController } from "./useUpdates";

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
		failedPhase: null,
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
	state: NativeUpdateState,
	requestError: NativeUpdateRequestError | null = null,
): UpdatesController {
	return {
		source: "native",
		state,
		requestError,
		checkForUpdates: () => {},
		downloadUpdate: () => {},
		restartToUpdate: () => {},
	};
}

function hostUpdates(state: HostUpdateNotice): UpdatesController {
	return { source: "host", state };
}

function render(updates: UpdatesController): string {
	return renderToStaticMarkup(<UpdateSettings updates={updates} />);
}

function renderAffordance(updates: UpdatesController): string {
	return renderToStaticMarkup(<UpdateReadyButton updates={updates} onOpen={() => {}} />);
}

test("idle native updates describe checks without claiming automatic downloads", () => {
	const markup = render(nativeUpdates(nativeState("idle")));
	expect(markup).toContain("ThinkRail is up to date");
	expect(markup).toContain("checks for new releases in the background");
	expect(markup).toContain("Downloads and installation begin only when you choose them");
	expect(markup).toContain("Check for Updates");
	expect(markup).not.toContain("downloads updates in the background");
});

test("available native update exposes Download with nightly public identity", () => {
	const markup = render(
		nativeUpdates(nativeState("available", { availableVersion: "0.1.0-nightly.46" })),
	);
	expect(markup).toContain("ThinkRail 0.1.0-nightly.46 is available");
	expect(markup).toContain('data-testid="update-download"');
	expect(markup).toContain("Download");
	expect(markup).toContain("Version 0.1.0-nightly.45 · nightly channel");
	expect(markup).not.toContain("canary channel");
	expect(markup.toLowerCase()).not.toContain("cryptograph");
	expect(markup.toLowerCase()).not.toContain("verified");
});

test("download transfer shows determinate progress", () => {
	const markup = render(
		nativeUpdates(
			nativeState("downloading", {
				availableVersion: "0.1.0-nightly.46",
				progress: 42,
			}),
		),
	);
	expect(markup).toContain('data-status="downloading"');
	expect(markup).toContain('value="42"');
	expect(markup).toContain("Downloading update — 42%");
	expect(markup).not.toContain('data-testid="update-download"');
});

test("preparation is a separate indeterminate native phase", () => {
	const markup = render(
		nativeUpdates(
			nativeState("preparing", {
				availableVersion: "0.1.0-nightly.46",
				progress: 100,
			}),
		),
	);
	expect(markup).toContain('data-status="preparing"');
	expect(markup).toContain("Preparing update");
	expect(markup).toContain('aria-label="Preparing update…"');
	expect(markup).not.toContain('value="100"');
	expect(markup.toLowerCase()).not.toContain("verification");
});

test("ready native update exposes Install & Restart and closing Settings as deferral", () => {
	const markup = render(
		nativeUpdates(nativeState("ready", { availableVersion: "0.1.0-nightly.46" })),
	);
	expect(markup).toContain("Install &amp; Restart");
	expect(markup).toContain("Close Settings to install later");
	expect(markup).toContain("Quitting ThinkRail normally does not install the update");
	expect(markup).not.toContain(">Later<");
	expect(markup).not.toContain("Are you sure");
});

test("installing native update remains visible without another action", () => {
	const updates = nativeUpdates(
		nativeState("installing", { availableVersion: "0.1.0-nightly.46" }),
	);
	const settings = render(updates);
	expect(settings).toContain("Installing update");
	expect(settings).not.toContain("Install &amp; Restart");
	const affordance = renderAffordance(updates);
	expect(affordance).toContain("Installing update");
});

test("native controller and request failures retry the recorded phase", () => {
	const downloadFailure = render(
		nativeUpdates(
			nativeState("error", {
				availableVersion: "0.1.0-nightly.46",
				error: "Download failed",
				failedPhase: "download",
			}),
		),
	);
	expect(downloadFailure).toContain('data-testid="update-retry"');
	expect(downloadFailure).toContain("Retry");
	expect(downloadFailure).toContain("Download failed");
	expect(downloadFailure).not.toContain('data-testid="update-download"');

	const requestFailure = render(
		nativeUpdates(nativeState("available", { availableVersion: "0.1.0-nightly.46" }), {
			action: "download",
			message: "The update request timed out",
		}),
	);
	expect(requestFailure).toContain("The update request failed");
	expect(requestFailure).toContain("The update request timed out");
	expect(requestFailure).toContain('data-testid="update-retry"');
	expect(requestFailure).not.toContain('data-testid="update-download"');
});

test("a retained ready package keeps install available beside an unrelated check retry", () => {
	const markup = render(
		nativeUpdates(
			nativeState("ready", {
				availableVersion: "0.1.0-nightly.46",
				error: "The background check failed",
				failedPhase: "check",
			}),
		),
	);
	expect(markup).toContain("The background check failed");
	expect(markup).toContain('data-testid="update-retry"');
	expect(markup).toContain("Install &amp; Restart");
});

test("the native topbar affordance covers every actionable phase with clear labels", () => {
	const cases: Array<[NativeUpdateState["status"], string]> = [
		["available", "Update available"],
		["downloading", "Downloading 42%"],
		["preparing", "Preparing update"],
		["ready", "Update ready"],
		["installing", "Installing update"],
		["error", "Update needs attention"],
	];
	for (const [status, label] of cases) {
		const markup = renderAffordance(
			nativeUpdates(
				nativeState(status, {
					availableVersion: "0.1.0-nightly.46",
					progress: status === "downloading" ? 42 : null,
					failedPhase: status === "error" ? "download" : null,
				}),
			),
		);
		expect(markup).toContain('data-testid="update-ready"');
		expect(markup).toContain('data-source="native"');
		expect(markup).toContain(label);
	}
});

test("a native request error remains discoverable from the topbar", () => {
	const markup = renderAffordance(
		nativeUpdates(nativeState("idle"), { action: "check", message: "RPC failed" }),
	);
	expect(markup).toContain("Update needs attention");
});

test("a host notice keeps immutable release details and fixed machine guidance only", () => {
	const markup = render(hostUpdates(hostNotice()));
	expect(markup).toContain("ThinkRail 0.2.0 is available");
	expect(markup).toContain("Current: 0.1.0 · stable channel");
	expect(markup).toContain("Available: 0.2.0");
	expect(markup).toContain("thinkrail update");
	expect(markup).toContain("on the machine running the host, then restart ThinkRail");
	expect(markup).toContain('data-source="host"');
	expect(markup).not.toContain("Check for Updates");
	expect(markup).not.toContain("Retry");
	expect(markup).not.toContain("Download");
	expect(markup).not.toContain("Install &amp; Restart");
	expect(markup).not.toContain("<progress");
});

test("a host notice still exposes the shared Update available affordance", () => {
	const markup = renderAffordance(hostUpdates(hostNotice()));
	expect(markup).toContain('data-testid="update-ready"');
	expect(markup).toContain('data-source="host"');
	expect(markup).toContain("Update available");
	expect(markup).toContain("ThinkRail 0.2.0 is available");
});
