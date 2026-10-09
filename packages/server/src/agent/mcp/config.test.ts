import { afterAll, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LoadedMcpConfig } from "@earendil-works/pi-coding-agent";
import {
	addMcpServerConfig,
	assertProjectMcpConfigWritable,
	fingerprintMcpEntry,
	loadHostMcpConfig,
	loadMcpConfigFiles,
	McpConfigPathUnsafeError,
	normalizeExposureForHost,
	removeMcpServerConfig,
	updateMcpServerConfig,
	validateMcpServerConfig,
} from "./index";

const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const piConfig = (await import(join(piDist, "extensions", "mcp", "config.js"))) as {
	loadMcpConfig: (options: {
		agentDir: string;
		cwd: string;
		projectTrusted: boolean;
	}) => LoadedMcpConfig;
};

const root = mkdtempSync(join(tmpdir(), "mcp-config-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let sequence = 0;
function fixture(globalConfig: unknown, projectConfig?: unknown) {
	const dir = join(root, `case-${++sequence}`);
	const agentDir = join(dir, "agent");
	const cwd = join(dir, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	if (globalConfig !== undefined) {
		writeFileSync(
			join(agentDir, "mcp.json"),
			typeof globalConfig === "string" ? globalConfig : JSON.stringify(globalConfig, null, 2),
		);
	}
	if (projectConfig !== undefined) {
		writeFileSync(
			join(cwd, ".pi", "mcp.json"),
			typeof projectConfig === "string" ? projectConfig : JSON.stringify(projectConfig, null, 2),
		);
	}
	return { agentDir, cwd };
}

const PARITY_CASES: { name: string; global: unknown; project?: unknown }[] = [
	{
		name: "valid stdio and http servers with env, headers and oauth",
		global: {
			mcpServers: {
				fs: { command: "npx", args: ["-y", "server"], env: { TOKEN: `\${TOKEN}` }, cwd: "~/x" },
				docs: {
					url: "https://example.com/mcp",
					headers: { Authorization: `Bearer \${DOCS}` },
					oauth: { clientId: "abc", callbackPort: 8765, scope: "read" },
					exposure: "direct",
					toolExposure: { "delete_*": "hidden", get_one: "direct" },
					timeout: 30,
					description: "Docs",
				},
				off: { url: "https://off.example/mcp", enabled: false },
			},
		},
	},
	{
		name: "every validation error pi reports",
		global: {
			mcpServers: {
				"bad name": { command: "x" },
				sse: { type: "sse", url: "https://x/sse" },
				badurl: { url: "not a url" },
				exposure: { url: "https://x/mcp", exposure: "sometimes" },
				tools: { url: "https://x/mcp", toolExposure: { a: "nope" } },
				timeout: { url: "https://x/mcp", timeout: 0 },
				args: { command: "x", args: "nope" },
				env: { command: "x", env: { A: 1 } },
				neither: { description: "no transport" },
				callback: { url: "https://x/mcp", oauth: { callbackUrl: "https://evil.example/cb" } },
				cimd: { url: "https://x/mcp", oauth: { clientRegistration: "cimd", clientId: "a" } },
				auth: { url: "http://x.example/mcp", auth: { provider: "anthropic" } },
			},
		},
	},
	{
		name: "exposure aliases and namespace clashes",
		global: {
			mcpServers: {
				"my-server": { url: "https://a/mcp", exposure: "codemode-deferred" },
				my_server: { url: "https://b/mcp" },
			},
		},
	},
	{
		name: "project overrides, replacements and the project auth ban",
		global: {
			mcpServers: {
				linear: { url: "https://mcp.linear.app/mcp", enabled: false },
				notion: { url: "https://mcp.notion.com/mcp" },
			},
		},
		project: {
			mcpServers: {
				linear: { enabled: true, exposure: "direct" },
				notion: { url: "https://impostor.example/mcp" },
				ghost: { enabled: true },
				extra: { enabled: true, headers: { A: "b" } },
				bad: { url: "https://x/mcp", auth: { provider: "anthropic" } },
				local: { command: "./bin/server", cwd: "tools" },
			},
			autoEnableCodemode: false,
		},
	},
	{
		name: "entries that are not objects",
		global: { mcpServers: { bad: null, list: [1], text: "x" } },
		project: { mcpServers: { odd: 5, none: null } },
	},
	{ name: "malformed global file", global: "{ not json" },
	{ name: "mcpServers that is not an object", global: { mcpServers: [] }, project: "[]" },
	{ name: "non-object top level", global: "[1,2]" },
	{ name: "autoEnableCodemode type error", global: { mcpServers: {}, autoEnableCodemode: "yes" } },
	{ name: "no files at all", global: undefined },
];

for (const { name, global: globalConfig, project } of PARITY_CASES) {
	test(`parity with pi's loader: ${name}`, () => {
		const { agentDir, cwd } = fixture(globalConfig, project);
		for (const projectTrusted of [true, false]) {
			const ours = loadMcpConfigFiles({ agentDir, cwd, projectTrusted });
			const { entries: _entries, fileErrors: _fileErrors, ...comparable } = ours;
			expect(comparable).toEqual(piConfig.loadMcpConfig({ agentDir, cwd, projectTrusted }));
		}
	});
}

test("entries keep every named entry as written, including override-only, invalid and non-object ones", () => {
	const { agentDir, cwd } = fixture(
		{ mcpServers: { linear: { url: "https://mcp.linear.app/mcp" }, bad: null } },
		{ mcpServers: { linear: { enabled: false }, broken: { type: "sse", url: "x" }, odd: [1] } },
	);
	const loaded = loadMcpConfigFiles({ agentDir, cwd, projectTrusted: true });
	expect(loaded.entries.map((entry) => [entry.name, entry.scope, entry.override])).toEqual([
		["linear", "global", false],
		["bad", "global", false],
		["linear", "project", true],
		["broken", "project", false],
		["odd", "project", false],
	]);
	expect(loaded.entries.find((entry) => entry.name === "bad")?.raw).toBeNull();
	expect(loaded.fileErrors).toEqual([]);
	expect(loaded.servers.find((s) => s.name === "linear")).toMatchObject({
		scope: "global",
		override: join(cwd, ".pi", "mcp.json"),
	});
});

test("file-level problems are listed per file, apart from entry errors, and never hide a parsable file's servers", () => {
	const malformed = fixture("{ not json", { mcpServers: [] });
	const broken = loadMcpConfigFiles({ ...malformed, projectTrusted: true });
	expect(broken.fileErrors.map((error) => error.path)).toEqual([
		join(malformed.agentDir, "mcp.json"),
		join(malformed.cwd, ".pi", "mcp.json"),
	]);
	expect(broken.fileErrors[1]?.message).toBe('expected an object with an "mcpServers" object');
	expect(broken.errors).toEqual(
		broken.fileErrors.map((error) => `${error.path}: ${error.message}`),
	);
	expect(broken.entries).toEqual([]);

	const typo = fixture({
		mcpServers: { docs: { url: "https://docs.example/mcp" }, bad: null },
		autoEnableCodemode: "yes",
	});
	const loaded = loadMcpConfigFiles({ ...typo, projectTrusted: false });
	expect(loaded.fileErrors).toEqual([
		{ path: join(typo.agentDir, "mcp.json"), message: "autoEnableCodemode must be a boolean" },
	]);
	expect(loaded.servers.map((server) => server.name)).toEqual(["docs"]);
	expect(loaded.errors).toHaveLength(2);
});

test("fingerprints cover the whole entry object, keep toolExposure order semantic, and ignore unrelated key order", () => {
	const base = {
		command: "npx",
		args: ["-y", "server@1.0.0"],
		env: { A: `\${A}`, B: "!cmd" },
		toolExposure: { "get_*": "direct", "*": "hidden" },
	};
	const fp = fingerprintMcpEntry("srv", base);
	expect(fingerprintMcpEntry("srv", { ...base, args: ["-y", "server@1.0.1"] })).not.toBe(fp);
	expect(fingerprintMcpEntry("srv", { ...base, enabled: false })).not.toBe(fp);
	expect(fingerprintMcpEntry("srv", { ...base, env: { A: `\${A}`, B: "!other" } })).not.toBe(fp);
	expect(
		fingerprintMcpEntry("srv", { ...base, toolExposure: { "*": "hidden", "get_*": "direct" } }),
	).not.toBe(fp);
	expect(fingerprintMcpEntry("other", base)).not.toBe(fp);
	expect(
		fingerprintMcpEntry("srv", {
			toolExposure: base.toolExposure,
			env: base.env,
			args: base.args,
			command: base.command,
		}),
	).toBe(fp);
	expect(fingerprintMcpEntry("srv", { ...base, env: { B: "!cmd", A: `\${A}` } })).toBe(fp);
});

test("host exposure normalization maps codemode and unset to deferred without touching other values", () => {
	const config = validateMcpServerConfig("s", {
		url: "https://x/mcp",
		toolExposure: { a: "codemode", b: "direct", c: "hidden" },
	});
	if (typeof config === "string") throw new Error(config);
	expect(normalizeExposureForHost(config)).toMatchObject({
		exposure: "deferred",
		toolExposure: { a: "deferred", b: "direct", c: "hidden" },
	});
	const direct = validateMcpServerConfig("s", { url: "https://x/mcp", exposure: "direct" });
	if (typeof direct === "string") throw new Error(direct);
	expect(normalizeExposureForHost(direct).exposure).toBe("direct");
});

test("the host loader admits repo entries only at their approved fingerprint and layers the record over user servers", () => {
	const repoServer = { command: "npx", args: ["-y", "repo-server"] };
	const repoOverride = { exposure: "direct" };
	const { agentDir, cwd } = fixture(
		{
			mcpServers: {
				docs: { url: "https://docs.example/mcp" },
				linear: { url: "https://linear.example/mcp", exposure: "codemode" },
				quiet: { url: "https://quiet.example/mcp" },
			},
		},
		{ mcpServers: { repo: repoServer, linear: repoOverride } },
	);
	const load = (approvals: Record<string, string>, disabledInChat?: Set<string>) =>
		loadHostMcpConfig({
			agentDir,
			cwd,
			projectTrusted: true,
			policy: {
				approvals,
				overrides: {
					docs: { enabled: false },
					quiet: { exposure: "hidden" },
					repo: { enabled: false },
				},
			},
			...(disabledInChat ? { disabledInChat } : {}),
		});
	const byName = (loaded: ReturnType<typeof load>) =>
		Object.fromEntries(loaded.servers.map((server) => [server.name, server]));

	const pending = byName(load({}));
	expect(Object.keys(pending).sort()).toEqual(["docs", "linear", "quiet"]);
	expect(pending.linear?.config.exposure).toBe("deferred");
	expect(pending.linear?.override).toBeUndefined();
	expect(pending.docs?.config.enabled).toBe(false);
	expect(pending.quiet?.config.exposure).toBe("hidden");

	const approvals = {
		repo: fingerprintMcpEntry("repo", repoServer),
		linear: fingerprintMcpEntry("linear", repoOverride),
	};
	const approved = byName(load(approvals, new Set(["quiet"])));
	expect(approved.repo?.scope).toBe("project");
	expect(approved.repo?.config.enabled).toBeUndefined();
	expect(approved.repo?.config.exposure).toBe("deferred");
	expect(approved.linear?.config.exposure).toBe("direct");
	expect(approved.quiet?.config.enabled).toBe(false);

	const changed = byName(
		load({
			...approvals,
			repo: fingerprintMcpEntry("repo", { ...repoServer, args: ["-y", "other"] }),
		}),
	);
	expect(changed.repo).toBeUndefined();
	expect(load(approvals).entries.filter((entry) => entry.scope === "project")).toHaveLength(2);
});

test("writers keep unknown keys and indentation, drop global defaults, and replace the file atomically", () => {
	const dir = join(root, "writers");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "mcp.json");
	writeFileSync(path, '{\n    "extra": true,\n    "mcpServers": {}\n}\n');
	chmodSync(path, 0o600);
	expect(addMcpServerConfig(path, "a", { url: "https://a/mcp" })).toBe(false);
	expect(addMcpServerConfig(path, "a", { url: "https://a2/mcp" })).toBe(true);
	updateMcpServerConfig(path, "a", { enabled: false, exposure: "direct" });
	updateMcpServerConfig(path, "a", { enabled: true, exposure: "codemode" });
	const text = readFileSync(path, "utf8");
	expect(text.startsWith('{\n    "extra": true,')).toBe(true);
	expect(JSON.parse(text)).toEqual({ extra: true, mcpServers: { a: { url: "https://a2/mcp" } } });
	expect(statSync(path).mode & 0o777).toBe(0o600);
	expect(removeMcpServerConfig(path, "missing")).toBe(false);
	expect(removeMcpServerConfig(path, "a")).toBe(true);
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ extra: true, mcpServers: {} });

	expect(removeMcpServerConfig(path, "__proto__")).toBe(false);
	expect(addMcpServerConfig(path, "__proto__", { url: "https://p/mcp" })).toBe(false);
	expect(readFileSync(path, "utf8")).toContain('"__proto__": {');
	updateMcpServerConfig(path, "__proto__", { enabled: false });
	const proto = JSON.parse(readFileSync(path, "utf8")).mcpServers;
	expect(Object.hasOwn(proto, "__proto__")).toBe(true);
	expect(Object.getOwnPropertyDescriptor(proto, "__proto__")?.value).toEqual({
		url: "https://p/mcp",
		enabled: false,
	});
	expect(removeMcpServerConfig(path, "__proto__")).toBe(true);
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ extra: true, mcpServers: {} });
});

test("an override entry keeps explicit values instead of dropping defaults", () => {
	const path = join(root, "override", ".pi", "mcp.json");
	updateMcpServerConfig(
		path,
		"linear",
		{ enabled: true, exposure: "codemode" },
		{ override: true },
	);
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
		mcpServers: { linear: { enabled: true, exposure: "codemode" } },
	});
});

test("project config writes refuse symlinked .pi directories and files, and paths outside the worktree", () => {
	const worktree = join(root, "containment", "wt");
	const elsewhere = join(root, "containment", "elsewhere");
	mkdirSync(join(elsewhere, "pi"), { recursive: true });
	mkdirSync(worktree, { recursive: true });
	symlinkSync(join(elsewhere, "pi"), join(worktree, ".pi"));
	expect(() => assertProjectMcpConfigWritable(worktree, join(worktree, ".pi", "mcp.json"))).toThrow(
		McpConfigPathUnsafeError,
	);
	rmSync(join(worktree, ".pi"));
	mkdirSync(join(worktree, ".pi"));
	writeFileSync(join(elsewhere, "secrets.json"), "{}");
	symlinkSync(join(elsewhere, "secrets.json"), join(worktree, ".pi", "mcp.json"));
	expect(() => assertProjectMcpConfigWritable(worktree, join(worktree, ".pi", "mcp.json"))).toThrow(
		/non-regular/,
	);
	expect(() => assertProjectMcpConfigWritable(worktree, join(elsewhere, "mcp.json"))).toThrow(
		/outside the worktree/,
	);
	rmSync(join(worktree, ".pi", "mcp.json"));
	expect(() =>
		assertProjectMcpConfigWritable(worktree, join(worktree, ".pi", "mcp.json")),
	).not.toThrow();
});
