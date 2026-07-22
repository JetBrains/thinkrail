import { describe, expect, it } from "bun:test";
import { decideSkill, isSkillLoaded, type SkillAdmissionContext } from "./skillAdmission";

const EMPTY: SkillAdmissionContext = {
	trusted: false,
	acknowledged: [],
	disabled: [],
	overrides: {},
};
const alias = (name: string) => ({ name, isProjectAlias: true });
const own = (name: string) => ({ name, isProjectAlias: false });

describe("decideSkill — trust gate (project-scoped aliases)", () => {
	it("withholds an alias until the project is trusted", () => {
		expect(decideSkill(alias("deploy"), EMPTY)).toBe("untrusted");
	});

	it("flags a trusted-but-unacknowledged alias as pending-ack (appeared after the grant)", () => {
		expect(decideSkill(alias("deploy"), { ...EMPTY, trusted: true })).toBe("pending-ack");
	});

	it("loads an acknowledged alias under a trusted project", () => {
		expect(
			decideSkill(alias("deploy"), { ...EMPTY, trusted: true, acknowledged: ["deploy"] }),
		).toBe("load");
	});

	it("never gates personal/bundled/pi-native skills on trust", () => {
		expect(decideSkill(own("brainstorming"), EMPTY)).toBe("load");
	});
});

describe("decideSkill — enable/disable (workspace override over project baseline)", () => {
	it("project baseline disables a skill", () => {
		expect(decideSkill(own("noisy"), { ...EMPTY, disabled: ["noisy"] })).toBe("disabled");
	});

	it("a workspace 'off' override disables an otherwise-loaded skill", () => {
		expect(decideSkill(own("x"), { ...EMPTY, overrides: { x: "off" } })).toBe("disabled");
	});

	it("a workspace 'on' override re-enables a project-baseline-disabled skill", () => {
		expect(decideSkill(own("x"), { ...EMPTY, disabled: ["x"], overrides: { x: "on" } })).toBe(
			"load",
		);
	});

	it("the workspace override wins over the project baseline both ways", () => {
		expect(decideSkill(own("x"), { ...EMPTY, disabled: ["x"], overrides: { x: "off" } })).toBe(
			"disabled",
		);
		expect(decideSkill(own("y"), { ...EMPTY, overrides: { y: "off" } })).toBe("disabled");
	});
});

describe("decideSkill — the trust gate is checked before the toggle layer (safety)", () => {
	it("an 'on' override can NOT un-gate an untrusted alias", () => {
		expect(decideSkill(alias("evil"), { ...EMPTY, overrides: { evil: "on" } })).toBe("untrusted");
	});

	it("an 'on' override can NOT un-gate a trusted-but-unacknowledged alias", () => {
		expect(decideSkill(alias("evil"), { ...EMPTY, trusted: true, overrides: { evil: "on" } })).toBe(
			"pending-ack",
		);
	});

	it("an acknowledged alias can still be turned off by a workspace override", () => {
		expect(
			decideSkill(alias("deploy"), {
				trusted: true,
				acknowledged: ["deploy"],
				disabled: [],
				overrides: { deploy: "off" },
			}),
		).toBe("disabled");
	});
});

describe("isSkillLoaded", () => {
	it("is true only for a 'load' verdict", () => {
		expect(isSkillLoaded(own("a"), EMPTY)).toBe(true);
		expect(isSkillLoaded(alias("a"), EMPTY)).toBe(false);
	});
});
