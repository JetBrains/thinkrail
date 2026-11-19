/**
 * Re-records the board's OpenSpec conformance fixtures with the real CLI (not run in CI):
 *
 *   bun thinkrail-extensions/board/scripts/record-openspec-fixtures.ts [version] [--work <dir>]
 *
 * It installs `@fission-ai/openspec@<version>` (default 2.1.0) into the work folder, builds every case there
 * through the CLI — `openspec init --tools none --scope project --no-animation --no-copilot-cloud .` (no
 * prompt, no skills, no global state: HOME and XDG folders point into the work folder, telemetry off) and
 * `openspec new change <name> --goal <goal>`, then the case's artifacts — and records `list --all --json
 * --sort name`, `status --all --json`, `validate --all --strict --json` and `show <name> --json
 * --deltas-only` for each active change with deltas, beside its `openspec/**` tree, under
 * `server/openspec/fixtures/<case>/`. Absolute paths read `<root>`; `version.txt` names the CLI.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { upsertTopLevelKey } from "../server/openspec/yaml";

const PACKAGE = resolve(dirname(new URL(import.meta.url).pathname), "..");
const FIXTURES = join(PACKAGE, "server", "openspec", "fixtures");
const INIT = [
	"init",
	"--tools",
	"none",
	"--scope",
	"project",
	"--no-animation",
	"--no-copilot-cloud",
	".",
];

const args = process.argv.slice(2);
const workFlag = args.indexOf("--work");
const work =
	workFlag >= 0
		? resolve(args[workFlag + 1] ?? "")
		: mkdtempSync(join(tmpdir(), "openspec-fixtures-"));
const version =
	args.find((arg, index) => !arg.startsWith("--") && index !== workFlag + 1) ?? "2.1.0";

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "home"), { recursive: true });
const env = {
	...process.env,
	HOME: join(work, "home"),
	XDG_CONFIG_HOME: join(work, "home", ".config"),
	XDG_DATA_HOME: join(work, "home", ".local", "share"),
	OPENSPEC_TELEMETRY: "0",
	DO_NOT_TRACK: "1",
	OPENSPEC_NO_UPDATE_CHECK: "1",
	OPENSPEC_NO_ANIMATION: "1",
	OPENSPEC_NO_COMPLETIONS: "1",
	NO_COLOR: "1",
	CI: "1",
};

function run(cwd: string, argv: string[], allowFailure = false): string {
	const result = spawnSync(argv[0] ?? "", argv.slice(1), { cwd, env, encoding: "utf8" });
	if (result.status !== 0 && !allowFailure)
		throw new Error(
			`${argv.join(" ")} failed (${result.status}):\n${result.stderr}${result.stdout}`,
		);
	return result.stdout;
}

const cliPrefix = join(work, "cli");
mkdirSync(cliPrefix, { recursive: true });
run(cliPrefix, [
	"npm",
	"install",
	"--no-save",
	"--no-audit",
	"--no-fund",
	"--prefix",
	cliPrefix,
	`@fission-ai/openspec@${version}`,
]);
const CLI = join(cliPrefix, "node_modules", ".bin", "openspec");
const recorded = run(cliPrefix, [CLI, "--version"]).trim();

type Files = Record<string, string>;

interface Case {
	name: string;
	build: (project: Project) => void;
}

class Project {
	readonly root: string;
	constructor(root: string) {
		this.root = root;
	}
	cli(...argv: string[]): string {
		return run(this.root, [CLI, ...argv]);
	}
	newChange(name: string, goal: string): void {
		this.cli("new", "change", name, "--goal", goal);
	}
	write(files: Files): void {
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(this.root, path)), { recursive: true });
			writeFileSync(join(this.root, path), text);
		}
	}
	read(path: string): string {
		return readFileSync(join(this.root, path), "utf8");
	}
}

const proposal = (title: string, why: string, what: string, capabilities: string) =>
	`# ${title}\n\n## Why\n\n${why}\n\n## What Changes\n\n${what}\n\n## Capabilities\n\n${capabilities}\n\n## Impact\n\nThe login API and its settings page.\n`;

const scenario = (when: string, then: string) =>
	`#### Scenario: ${when.split(" ").slice(0, 4).join(" ")}\n- **WHEN** ${when}\n- **THEN** ${then}\n`;

const requirement = (name: string, text: string, when: string, then: string) =>
	`### Requirement: ${name}\n${text}\n\n${scenario(when, then)}`;

const livingSpec = (capability: string, purpose: string, requirements: string) =>
	`# ${capability} Specification\n\n## Purpose\n\n${purpose}\n\n## Requirements\n\n${requirements}`;

const AUTH_SPEC = livingSpec(
	"auth",
	"Sign users in to their accounts and keep each session bound to the person who started it.",
	requirement(
		"Password login",
		"The system SHALL authenticate a user with an email and a password.",
		"a user submits a matching email and password",
		"a session starts for that user",
	),
);

const TWO_FACTOR_PROPOSAL = proposal(
	"Add TOTP two-factor login",
	"Passwords alone are phished every week; a second factor stops a stolen password from opening an account.",
	"- Add TOTP enrollment on the security page.\n- Ask for a TOTP code after the password once enrolled.",
	"### New Capabilities\n- `audit-log`: a record of security events\n\n### Modified Capabilities\n- `auth`: login asks for a second factor",
);

const TWO_FACTOR_DESIGN =
	"# Design\n\n## Context\n\nTOTP per RFC 6238 with a 30-second step.\n\n## Decisions\n\n- Secrets are encrypted at rest.\n";

const twoFactorTasks = (done: number) => {
	const tasks = [
		"1.1 Add the encrypted TOTP secret column",
		"1.2 Show the enrollment QR code on the security page",
		"1.3 Verify the first code before enabling",
		"2.1 Ask for the code after the password",
		"2.2 Accept a recovery code instead",
		"2.3 Record each second-factor event in the audit log",
		"3.1 Document the enrollment flow",
	];
	const line = (task: string, index: number) => `- [${index < done ? "x" : " "}] ${task}`;
	return `## 1. Enrollment\n\n${tasks.slice(0, 3).map(line).join("\n")}\n\n## 2. Login\n\n${tasks
		.slice(3, 6)
		.map((task, index) => line(task, index + 3))
		.join("\n")}\n\n## 3. Docs\n\n${line(tasks[6] ?? "", 6)}\n`;
};

const TWO_FACTOR_DELTA = `## ADDED Requirements\n\n${requirement(
	"TOTP enrollment",
	"The system SHALL let a user enroll a TOTP authenticator.",
	"a user scans the QR code and confirms a valid code",
	"two-factor login is enabled and recovery codes are shown once",
)}\n${requirement(
	"Recovery codes",
	"The system SHALL accept a single-use recovery code in place of a TOTP code.",
	"a user enters an unused recovery code",
	"the login completes and that code is spent",
)}\n## MODIFIED Requirements\n\n${requirement(
	"Password login",
	"The system SHALL authenticate a user with an email and a password and, once enrolled, a TOTP code.",
	"a user submits a matching email and password",
	"a session starts for that user",
)}`;

const AUDIT_DELTA = `## ADDED Requirements\n\n${requirement(
	"Security events",
	"The system SHALL record every second-factor enrollment and login attempt.",
	"a user enrolls a TOTP authenticator",
	"an audit entry names the user and the time",
)}`;

const twoFactor = (project: Project, done: number) => {
	project.write({ "openspec/specs/auth/spec.md": AUTH_SPEC });
	project.newChange("add-2fa-login", "Add TOTP two-factor login");
	const dir = "openspec/changes/add-2fa-login";
	project.write({
		[`${dir}/proposal.md`]: TWO_FACTOR_PROPOSAL,
		[`${dir}/specs/auth/spec.md`]: TWO_FACTOR_DELTA,
		[`${dir}/specs/audit-log/spec.md`]: AUDIT_DELTA,
		[`${dir}/design.md`]: TWO_FACTOR_DESIGN,
		[`${dir}/tasks.md`]: twoFactorTasks(done),
	});
};

const CASES: Case[] = [
	{ name: "empty", build: () => {} },
	{
		name: "planning",
		build: (project) => {
			project.newChange("add-webhook-retries", "Retry failed webhook deliveries with backoff");
			project.write({
				"openspec/changes/add-webhook-retries/proposal.md": proposal(
					"Retry failed webhook deliveries with backoff",
					"A receiver that is down for a minute loses every event sent meanwhile, and nobody notices until a customer asks.",
					"- Retry a failed delivery with exponential backoff for a day.",
					"### New Capabilities\n- `webhooks`: delivery and retries",
				),
			});
		},
	},
	{
		name: "ready",
		build: (project) => {
			twoFactor(project, 0);
		},
	},
	{ name: "in-progress", build: (project) => twoFactor(project, 3) },
	{
		name: "complete-archived",
		build: (project) => {
			project.newChange("add-refunds", "Partial refunds");
			const refunds = "openspec/changes/add-refunds";
			project.write({
				[`${refunds}/proposal.md`]: proposal(
					"Partial refunds",
					"Support refunds only whole orders today, so a customer returning one item waits for a manual credit.",
					"- Refund any amount up to what was captured.",
					"### New Capabilities\n- `billing`: refunds",
				),
				[`${refunds}/specs/billing/spec.md`]: `## Purpose\n\nCharge customers and give money back when an order is returned in part or in full.\n\n## ADDED Requirements\n\n${requirement(
					"Partial refund",
					"The system SHALL refund any amount up to the captured total of an order.",
					"an agent refunds part of a captured order",
					"the customer is credited that amount",
				)}`,
				[`${refunds}/design.md`]: "# Design\n\nRefunds reuse the capture's payment method.\n",
				[`${refunds}/tasks.md`]:
					"## 1. Refunds\n\n- [x] 1.1 Add the refund endpoint\n- [x] 1.2 Credit the payment method\n",
			});
			project.write({
				[`${refunds}/.openspec.yaml`]: upsertTopLevelKey(
					project.read(`${refunds}/.openspec.yaml`),
					"x-thinkrail",
					{
						card: "PA-3",
						workspace: "ws-refunds",
					},
				),
			});
			project.cli("archive", "add-refunds", "-y");
			project.newChange("rate-limit-login", "Rate-limit login attempts per IP");
			const limits = "openspec/changes/rate-limit-login";
			project.write({
				[`${limits}/proposal.md`]: proposal(
					"Rate-limit login attempts per IP",
					"Credential stuffing runs thousands of guesses a minute against the login endpoint from a few addresses.",
					"- Limit login attempts per IP address.",
					"### New Capabilities\n- `rate-limits`: login throttling",
				),
				[`${limits}/specs/rate-limits/spec.md`]: `## ADDED Requirements\n\n${requirement(
					"Login throttle",
					"The system SHALL refuse more than ten login attempts per minute from one IP address.",
					"an address sends an eleventh attempt within a minute",
					"the attempt is refused with a retry time",
				)}`,
				[`${limits}/design.md`]: "# Design\n\nA sliding window per address in the cache.\n",
				[`${limits}/tasks.md`]:
					"## 1. Throttle\n\n- [x] 1.1 Count attempts per address\n- [X] 1.2 Refuse past the limit\n",
			});
		},
	},
	{
		name: "invalid",
		build: (project) => {
			project.write({
				"openspec/specs/notifications/spec.md": livingSpec(
					"notifications",
					"Tell customers about their orders through the channels they chose when they signed up.",
					`${requirement(
						"Email channel",
						"The system SHALL send order updates by email.",
						"an order ships",
						"the customer gets an email",
					)}\n${requirement(
						"SMS channel",
						"The system SHALL send order updates by SMS.",
						"an order ships",
						"the customer gets a text message",
					)}`,
				),
			});
			project.newChange("drop-legacy-sms", "Remove the SMS notification channel");
			const dir = "openspec/changes/drop-legacy-sms";
			project.write({
				[`${dir}/proposal.md`]: proposal(
					"Remove SMS notification channel",
					"The SMS provider is being shut down and fewer than one percent of customers still pick text messages.",
					"- Remove the SMS channel.\n- Add push notifications.",
					"### Modified Capabilities\n- `notifications`: SMS removed, push added",
				),
				[`${dir}/specs/notifications/spec.md`]:
					"## REMOVED Requirements\n\n### Requirement: SMS channel\n\n## ADDED Requirements\n\n### Requirement: Push channel\nOrder updates go out as push notifications.\n",
			});
		},
	},
	{
		name: "edge-cases",
		build: (project) => {
			project.write({
				"openspec/schemas/research-first/schema.yaml": [
					"name: research-first",
					"version: 1",
					"description: Research before planning, tasks split across files",
					"artifacts:",
					"  - id: research",
					"    generates: research.md",
					"    description: What we learned",
					"    template: research.md",
					"    requires: []",
					"  - id: plan",
					"    generates: plan.md",
					"    description: The plan",
					"    template: plan.md",
					"    instruction: |",
					"      Write the plan.",
					"      # Not a comment: block scalar text.",
					"    requires: [research]",
					"  - id: tasks",
					'    generates: "tasks/*.md"',
					"    description: The tasks, one file per area",
					"    template: tasks.md",
					"    requires:",
					"      - plan",
					"apply:",
					"  requires: [tasks]",
					'  tracks: "tasks/*.md"',
					"",
				].join("\n"),
				"openspec/schemas/research-first/templates/research.md": "# Research\n",
				"openspec/schemas/research-first/templates/plan.md": "# Plan\n",
				"openspec/schemas/research-first/templates/tasks.md": "# Tasks\n",
				"openspec/specs/identity/sso/spec.md": livingSpec(
					"identity/sso",
					"Let employees sign in through the company identity provider instead of a password of their own.",
					requirement(
						"SAML login",
						"The system SHALL accept a signed SAML assertion from the configured provider.",
						"an employee returns from the provider with a valid assertion",
						"a session starts for that employee",
					),
				),
			});
			project.newChange("task-forms", "Every checkbox form OpenSpec counts");
			const forms = "openspec/changes/task-forms";
			project.write({
				[`${forms}/proposal.md`]: proposal(
					"Task forms",
					"The board counts tasks the way OpenSpec does, so every checkbox form it reads needs a recorded answer.",
					"- Nothing ships; this change exists for the fixtures.",
					"### Modified Capabilities\n- `identity/sso`: renamed and extended",
				),
				[`${forms}/design.md`]: "# Design\n\nNone.\n",
				[`${forms}/tasks.md`]: [
					"## 1. Forms",
					"",
					"- [ ] 1.1 open dash",
					"- [x] 1.2 done dash",
					"* [X] 1.3 done star, capital X",
					"+ [ ] 1.4 open plus",
					"1. [x] ordered with a dot",
					"2) [ ] ordered with a parenthesis",
					"- [~] 1.5 tilde stays open",
					"- [] 1.6 empty box stays open",
					"- [ x ] 1.7 padded x is done",
					"  - [x] 1.7.1 nested subtask counts",
					"- [A](https://example.com) a link bullet is no task",
					"- [WIP] a multi-character box is no task",
					"- plain bullet is no task",
					"",
					"```md",
					"- [ ] 1.8 inside a fence still counts",
					"```",
					"",
					"<!-- - [x] 1.9 inside a comment still counts -->",
					"",
				].join("\n"),
				[`${forms}/specs/identity/sso/spec.md`]: [
					"## RENAMED Requirements",
					"",
					"- FROM: `### Requirement: SAML login`",
					"- TO: `### Requirement: SAML sign-in`",
					"",
					"## ADDED Requirements",
					"",
					requirement(
						"OIDC login",
						"The system SHALL accept an OpenID Connect ID token from the configured provider.",
						"an employee returns with a valid ID token",
						"a session starts for that employee",
					),
					"```md",
					"### Requirement: Fenced example is no requirement",
					"```",
					"",
				].join("\n"),
			});
			project.newChange("metadata-only", "Only the metadata file");
			project.newChange("skip-specs", "A tooling change with no spec deltas");
			const skip = "openspec/changes/skip-specs";
			project.write({
				[`${skip}/.openspec.yaml`]: `${project.read(`${skip}/.openspec.yaml`)}skip_specs: true\n`,
				[`${skip}/proposal.md`]: proposal(
					"Faster CI",
					"The test suite takes twenty minutes and most of it is waiting for one slow shard to finish.",
					"- Rebalance the shards.",
					"None.",
				),
				[`${skip}/design.md`]: "# Design\n\nSort the specs by their last duration.\n",
				[`${skip}/tasks.md`]: "- [ ] Rebalance the shards\n",
			});
			project.cli("new", "change", "custom-flow", "--schema", "research-first");
			const custom = "openspec/changes/custom-flow";
			project.write({
				[`${custom}/research.md`]: "# Research\n\nTwo options.\n",
				[`${custom}/tasks/backend.md`]: "- [x] API\n- [ ] Worker\n",
				[`${custom}/tasks/frontend.md`]: "- [ ] Form\n",
			});
			project.write({
				"openspec/changes/mystery-schema/.openspec.yaml":
					"schema: no-such-schema\ncreated: 2026-01-01\n",
				"openspec/changes/mystery-schema/tasks.md": "- [x] One\n- [ ] Two\n",
			});
			project.write({
				[`${forms}/.openspec.yaml`]: upsertTopLevelKey(
					project.read(`${forms}/.openspec.yaml`),
					"x-thinkrail",
					{
						card: "TR-7",
						workspace: "ws-forms",
					},
				),
			});
		},
	},
];

const normalize = (text: string, root: string) => text.split(root).join("<root>");

function record(project: Project, out: string, command: string[], file: string): unknown {
	const stdout = run(project.root, [CLI, ...command], true);
	let value: unknown;
	try {
		value = JSON.parse(normalize(stdout, project.root));
	} catch {
		return null;
	}
	writeFileSync(join(out, file), `${JSON.stringify(value, null, "\t")}\n`);
	return value;
}

for (const fixture of CASES) {
	const root = join(work, "cases", fixture.name);
	mkdirSync(root, { recursive: true });
	const project = new Project(root);
	project.cli(...INIT);
	fixture.build(project);
	const out = join(FIXTURES, fixture.name);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	cpSync(join(root, "openspec"), join(out, "openspec"), { recursive: true });
	const list = record(project, out, ["list", "--all", "--json", "--sort", "name"], "list.json") as {
		changes: { name: string; archived: boolean }[];
	};
	record(project, out, ["status", "--all", "--json"], "status.json");
	record(project, out, ["validate", "--all", "--strict", "--json"], "validate.json");
	const shown = list.changes.filter((change) => !change.archived);
	if (shown.length > 0) mkdirSync(join(out, "show"), { recursive: true });
	for (const change of shown)
		record(
			project,
			out,
			["show", change.name, "--json", "--deltas-only"],
			join("show", `${change.name}.json`),
		);
	if (fixture.name === "ready") {
		const path = "openspec/changes/add-2fa-login/.openspec.yaml";
		const marked = upsertTopLevelKey(project.read(path), "x-thinkrail", {
			card: "PA-1",
			workspace: "ws-apply",
		});
		project.write({ [path]: marked });
		writeFileSync(join(out, "x-thinkrail.openspec.yaml"), marked);
		record(
			project,
			out,
			["validate", "add-2fa-login", "--strict", "--json"],
			"validate-x-thinkrail.json",
		);
	}
}
writeFileSync(join(FIXTURES, "version.txt"), `${recorded}\n`);
run(PACKAGE, ["bunx", "biome", "format", "--write", FIXTURES], true);
console.log(`Recorded ${CASES.length} cases with openspec ${recorded} into ${FIXTURES}`);
