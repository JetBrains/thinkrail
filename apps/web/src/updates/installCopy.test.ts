import { expect, test } from "bun:test";
import type { NativeUpdateState } from "@thinkrail/contracts";
import {
	formatInstallLog,
	INSTALL_STEPS,
	installFailureCopy,
	installProgress,
	installRecovery,
	installStepIndex,
	releaseNotesUrl,
} from "./installCopy";

function state(
	status: NativeUpdateState["status"],
	overrides: Partial<NativeUpdateState> = {},
): NativeUpdateState {
	return {
		revision: 1,
		status,
		version: "0.3.0-nightly.1",
		channel: "canary",
		availableVersion: "0.3.0-nightly.4",
		progress: null,
		error: null,
		failedPhase: null,
		installStep: null,
		log: [],
		lastInstall: null,
		...overrides,
	};
}

test("install steps advance a determinate bar from stopping to restarting", () => {
	expect(INSTALL_STEPS.map((step) => step.key)).toEqual([
		"prepared",
		"stopping",
		"handoff",
		"restarting",
	]);
	expect(installStepIndex(null)).toBe(1);
	expect(installStepIndex("stopping")).toBe(1);
	expect(installStepIndex("handoff")).toBe(2);
	expect(installStepIndex("restarting")).toBe(3);
	expect([
		installProgress("stopping"),
		installProgress("handoff"),
		installProgress("restarting"),
	]).toEqual([38, 63, 88]);
});

test("installer results become a plain cause, never the raw text as the headline", () => {
	const failed = (failedStep: string | null, detail: string | null = null) =>
		installFailureCopy({ outcome: "failed", failedStep, detail });
	expect(failed("swapping", "AccessDenied").cause).toBe(
		"Another program is using ThinkRail's install folder",
	);
	expect(failed("swapping", "AccessDenied").advice).toContain("JetBrains Central proxy");
	expect(failed("swapping", "FileBusy").cause).toBe(
		"The installer couldn't replace ThinkRail's files",
	);
	expect(failed("validating_payload").cause).toBe("The downloaded update was invalid");
	expect(failed("validating").cause).toBe("The downloaded update was invalid");
	expect(failed("extracting").cause).toBe("The update couldn't be unpacked");
	expect(failed("waiting_for_parent").cause).toBe("ThinkRail took too long to close");
	expect(failed("integrating").cause).toBe("The new version couldn't be registered");
	expect(failed("launching").cause).toBe("The new version didn't start");
	expect(failed("something_new", "Weird").cause).toBe("The installer couldn't finish");
	expect(installFailureCopy({ outcome: "unreported", failedStep: null, detail: null }).cause).toBe(
		"The installer didn't report a result",
	);
});

test("recovery follows the live update state and names the version it acts on", () => {
	expect(installRecovery(state("ready"))).toEqual({
		kind: "install",
		label: "Try again",
		detail: "Installs ThinkRail 0.3.0-nightly.4.",
	});
	expect(installRecovery(state("available"))).toMatchObject({
		kind: "download",
		label: "Download again",
	});
	expect(installRecovery(state("idle"))).toMatchObject({ kind: "check", label: "Check again" });
	expect(installRecovery(state("error"))).toMatchObject({ kind: "check" });
	expect(installRecovery(state("checking"))).toMatchObject({ kind: "pending" });
	expect(installRecovery(state("downloading", { progress: 41.6 }))).toMatchObject({
		kind: "pending",
		label: "Downloading 42%",
	});
	expect(installRecovery(state("preparing"))).toMatchObject({ kind: "pending" });
	expect(installRecovery(state("disabled"))).toBeNull();
});

test("release notes and copied logs use stable, readable forms", () => {
	expect(releaseNotesUrl("0.3.0-nightly.4")).toBe(
		"https://github.com/JetBrains/thinkrail/releases/tag/v0.3.0-nightly.4",
	);
	const at = new Date(2026, 9, 21, 12, 54, 4).getTime();
	expect(
		formatInstallLog([
			{ at, source: "host", level: "info", text: "Stopped in 1.9 s" },
			{ at, source: "installer", level: "error", text: "failed" },
		]),
	).toBe("12:54:04 host      Stopped in 1.9 s\n12:54:04 installer failed");
});
