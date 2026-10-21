import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");

function normalizePath(path: string): string {
	const real = realpathSync(path);
	return process.platform === "win32" ? real.toLowerCase() : real;
}

function normalizeCwds(cwds: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(cwds).map(([key, path]) => [key, normalizePath(path)]));
}

const outcomes = {
	updates: "update metadata failure before host acquisition quits directly",
	boot: "host boot failure quits directly",
	listener: "listener failure after host acquisition shuts the host down before quitting",
} as const;

const cases = [
	{ failure: "updates", userData: "override", home: "present" },
	{ failure: "boot", userData: "getter", home: "present" },
	{ failure: "listener", userData: "override", home: "present" },
	{ failure: "listener", userData: "getter", home: "present" },
	{ failure: "listener", userData: "override", home: "missing" },
] as const;

for (const { failure, userData, home } of cases) {
	const location =
		home === "missing"
			? "stays in the launch directory when home is missing"
			: "reads bundle metadata before leaving for home";
	test(`${outcomes[failure]} even if the error dialog fails; ${location} (user data from ${userData})`, () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-desktop-startup-"));
		try {
			const runtimePath = join(root, "app", "runtime", "server-runtime.ts");
			const userDataPath = join(root, "user-data");
			const homePath = home === "missing" ? join(root, "missing-home") : root;
			mkdirSync(join(root, "app", "runtime"), { recursive: true });
			mkdirSync(userDataPath);
			writeFileSync(runtimePath, "export {};\n");
			const script = `
import { mock } from "bun:test";
const failure = ${JSON.stringify(failure)};
const calls = [];
const cwd = {};
const listeners = [];
mock.module(${JSON.stringify(runtimePath)}, () => {
  cwd.runtime = process.cwd();
  return {
    startDesktopHost: async (options) => {
      if (typeof options.openExternal !== "function") throw new Error("missing packaged opener");
      calls.push("host");
      cwd.host = process.cwd();
      cwd.child = Bun.spawnSync([process.execPath, "-e", "process.stdout.write(process.cwd())"]).stdout.toString();
      if (failure === "boot") throw new Error("boot failed");
      return { port: 12345, server: { startAttributionClaim: () => calls.push("claim-ready"), shutdown: async () => {
        calls.push("shutdown-start");
        await Bun.sleep(10);
        calls.push("shutdown-end");
      } } };
    },
  };
});
const updateInfo = { version: "0.0.1", hash: "abc", updateAvailable: false, updateReady: false, error: "" };
mock.module("electrobun/main", () => ({
  default: {
    app: { isPackaged: true },
    events: { on: (name, callback) => {
      if (name !== "before-quit") throw new Error("unexpected subscription");
      calls.push("listener");
      if (failure === "listener") throw new Error("listener failed");
      listeners.push(callback);
    } },
  },
  ApplicationMenu: { setApplicationMenu() {}, on() {} },
  BrowserView: {},
  BrowserWindow: class {},
  PATHS: { RESOURCES_FOLDER: ${JSON.stringify(root)}, VIEWS_FOLDER: ${JSON.stringify(root)} },
  Updater: {
    getLocalInfo: async () => {
      calls.push("updates");
      cwd.updates = process.cwd();
      if (failure === "updates") throw new Error("update metadata failed");
      return { identifier: "ai.thinkrail.app", channel: "canary", version: "0.0.1", hash: "abc", baseUrl: "https://example.invalid/u", name: "ThinkRail-canary" };
    },
    updateInfo: () => updateInfo,
    onStatusChange: () => {},
    checkForUpdate: async () => updateInfo,
    downloadUpdate: async () => {},
    applyUpdate: async () => {},
  },
  Utils: {
    paths: { get userData() {
      cwd.userData ??= process.cwd();
      return ${JSON.stringify(userDataPath)};
    } },
    showMessageBox: async () => {
      calls.push("dialog");
      throw new Error("dialog failed");
    },
    quit: () => {
      const event = { response: undefined };
      for (const listener of listeners) listener(event);
      calls.push(event.response?.allow === false ? "quit-vetoed" : "quit");
    },
  },
}));
try { await import("./src/index.ts"); } catch (error) {
  if (!(error instanceof Error) || error.message !== "dialog failed") throw error;
}
console.log(JSON.stringify({ calls, cwd }));
`;
			const result = Bun.spawnSync([process.execPath, "--eval", script], {
				cwd: desktopDir,
				env: {
					...process.env,
					HOME: homePath,
					USERPROFILE: homePath,
					THINKRAIL_DESKTOP_USER_DATA: userData === "override" ? userDataPath : undefined,
					BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
					NODE_ENV: "test",
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(result.exitCode).toBe(0);
			expect(existsSync(homePath)).toBe(home === "present");
			const run = JSON.parse(result.stdout.toString()) as {
				calls: string[];
				cwd: Record<string, string>;
			};
			expect(run.calls).toEqual([
				"updates",
				...(failure === "updates" ? [] : ["host"]),
				...(failure === "listener" ? ["listener"] : []),
				"dialog",
				...(failure === "listener" ? ["shutdown-start", "shutdown-end"] : []),
				"quit",
			]);
			const launchDir = normalizePath(desktopDir);
			const childDir = home === "missing" ? launchDir : normalizePath(root);
			expect(normalizeCwds(run.cwd)).toEqual({
				...(userData === "getter" ? { userData: launchDir } : {}),
				updates: launchDir,
				...(failure === "updates" ? {} : { runtime: childDir, host: childDir, child: childDir }),
			});
			expect(result.stderr.toString().includes("could not leave the app bundle")).toBe(
				home === "missing",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}
