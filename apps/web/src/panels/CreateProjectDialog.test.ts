import { expect, test } from "bun:test";
import { joinHostPath } from "../lib";
import { projectFolderName } from "./CreateProjectDialog";

test("projectFolderName turns a typed name into one plain folder name", () => {
	expect(projectFolderName("  Weather App ")).toBe("weather-app");
	expect(projectFolderName("my_app.v2")).toBe("my_app.v2");
	expect(projectFolderName("../escape/attempt")).toBe("escape-attempt");
	expect(projectFolderName("Погода")).toBe("погода");
	expect(projectFolderName("...")).toBe("");
	expect(projectFolderName("  ")).toBe("");
});

test("joinHostPath keeps the host's separator and drops a trailing one", () => {
	expect(joinHostPath("~/thinkrail", "app")).toBe("~/thinkrail/app");
	expect(joinHostPath("/srv/code/", "app")).toBe("/srv/code/app");
	expect(joinHostPath("C:\\Users\\me\\code\\", "app")).toBe("C:\\Users\\me\\code\\app");
	expect(joinHostPath("C:\\Users\\me\\code", "src/app.ts")).toBe(
		"C:\\Users\\me\\code\\src\\app.ts",
	);
	expect(joinHostPath("/srv/code", "src/foo\\bar.ts")).toBe("/srv/code/src/foo\\bar.ts");
});
