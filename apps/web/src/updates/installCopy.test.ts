import { expect, test } from "bun:test";
import type { NativeUpdateLogEvent, NativeUpdateState } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import {
	formatInstallLog,
	INSTALL_STEPS,
	installFailureCopy,
	installLogSource,
	installLogText,
	installProgress,
	installRecovery,
	installStepIndex,
	releaseNotesUrl,
} from "./installCopy";

const t = currentTranslator();

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
		installFailureCopy(t, { outcome: "failed", failedStep, detail });
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
	expect(
		installFailureCopy(t, { outcome: "unreported", failedStep: null, detail: null }).cause,
	).toBe("The installer didn't report a result");
});

test("recovery follows the live update state and names the version it acts on", () => {
	expect(installRecovery(t, state("ready"))).toEqual({
		kind: "install",
		label: "Try again",
		detail: "Installs ThinkRail 0.3.0-nightly.4.",
	});
	expect(installRecovery(t, state("available"))).toMatchObject({
		kind: "download",
		label: "Download again",
	});
	expect(installRecovery(t, state("idle"))).toMatchObject({ kind: "check", label: "Check again" });
	expect(installRecovery(t, state("error"))).toMatchObject({ kind: "check" });
	expect(installRecovery(t, state("checking"))).toMatchObject({ kind: "pending" });
	expect(installRecovery(t, state("downloading", { progress: 41.6 }))).toMatchObject({
		kind: "pending",
		label: "Downloading 42%",
	});
	expect(installRecovery(t, state("preparing"))).toMatchObject({ kind: "pending" });
	expect(installRecovery(t, state("disabled"))).toBeNull();
});

test("release notes and copied logs use stable, readable forms", () => {
	expect(releaseNotesUrl("0.3.0-nightly.4")).toBe(
		"https://github.com/JetBrains/thinkrail/releases/tag/v0.3.0-nightly.4",
	);
	const at = new Date(2026, 9, 21, 12, 54, 4).getTime();
	expect(
		formatInstallLog(t, [
			{ at, source: "host", level: "info", event: { kind: "hostStopped", seconds: 1.94 } },
			{
				at,
				source: "installer",
				level: "error",
				event: {
					kind: "installFailed",
					version: "0.3.0-nightly.4",
					step: "swapping",
					detail: "AccessDenied",
				},
			},
			{
				at,
				source: "update",
				level: "error",
				event: { kind: "diagnostic", text: "Raw SDK error" },
			},
		]),
	).toBe(
		[
			"12:54:04 host      Stopped in 1.9 s",
			"12:54:04 installer Update to 0.3.0-nightly.4 failed during swapping: AccessDenied",
			"12:54:04 update    Raw SDK error",
		].join("\n"),
	);
});

test("every structured log event renders translated text; only diagnostics stay verbatim", () => {
	const version = "1.1.0";
	const events: NativeUpdateLogEvent[] = [
		{ kind: "installStarted", version },
		{ kind: "hostStopping" },
		{ kind: "handoffStarted" },
		{ kind: "restarting" },
		{ kind: "installed", version },
	];
	expect(events.map((event) => installLogText(t, event))).toEqual([
		"Installing ThinkRail 1.1.0",
		"Stopping agents and terminals",
		"Preparing the installer handoff",
		"Installer ready; restarting ThinkRail",
		"Update to 1.1.0 completed successfully",
	]);
	expect(installLogSource(t, "installer")).toBe("installer");
});
