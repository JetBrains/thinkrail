import { expect, test } from "bun:test";
import { parseAlertMarker } from "./markdownAlerts";

test("parseAlertMarker reads each variant, case-insensitively", () => {
	expect(parseAlertMarker("[!NOTE]\nbody")?.variant).toBe("note");
	expect(parseAlertMarker("[!Tip]\nbody")?.variant).toBe("tip");
	expect(parseAlertMarker("[!important]\nbody")?.variant).toBe("important");
	expect(parseAlertMarker("[!WARNING]\nbody")?.variant).toBe("warning");
	expect(parseAlertMarker("[!caution]\nbody")?.variant).toBe("caution");
});

test("parseAlertMarker strips the marker + its trailing newline, keeping the body", () => {
	expect(parseAlertMarker("[!NOTE]\nThe body text.")?.rest).toBe("The body text.");
	expect(parseAlertMarker("[!TIP]  inline")?.rest).toBe("inline");
	expect(parseAlertMarker("[!WARNING]")?.rest).toBe("");
});

test("parseAlertMarker returns null for non-markers", () => {
	expect(parseAlertMarker("just a normal quote")).toBeNull();
	expect(parseAlertMarker("[!UNKNOWN]\nbody")).toBeNull();
	expect(parseAlertMarker("text [!NOTE] not at start")).toBeNull();
});
