import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_DIALOG_LABELS,
	readDialogLabels,
	readNativeLabels,
	writeNativeLabels,
} from "./nativeLabels";

test("dialog labels take the pushed translation and fall back to English per label", () => {
	const labels = readDialogLabels({
		"desktop.dialog.startFailed": "ThinkRail konnte nicht starten",
		"desktop.dialog.quit": "   ",
		"desktop.dialog.updateRestartFailed": "x".repeat(201),
	});
	expect(labels["desktop.dialog.startFailed"]).toBe("ThinkRail konnte nicht starten");
	expect(labels["desktop.dialog.quit"]).toBe("Quit");
	expect(labels["desktop.dialog.updateRestartFailed"]).toBe(
		"ThinkRail could not restart to install the update",
	);
	expect(readDialogLabels(null)).toEqual(DEFAULT_DIALOG_LABELS);
});

test("the last pushed labels survive a restart so a startup failure can speak the user's language", () => {
	const dir = mkdtempSync(join(tmpdir(), "native-labels-"));
	const path = join(dir, "nested", "native-labels.json");
	expect(readDialogLabels(readNativeLabels(path))).toEqual(DEFAULT_DIALOG_LABELS);
	writeNativeLabels(path, { "desktop.dialog.quit": "Beenden" });
	expect(readDialogLabels(readNativeLabels(path))["desktop.dialog.quit"]).toBe("Beenden");
	writeFileSync(path, "{ not json");
	expect(readDialogLabels(readNativeLabels(path))).toEqual(DEFAULT_DIALOG_LABELS);
});
