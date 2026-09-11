import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");

for (const failure of ["boot", "listener", "updates"] as const) {
	test(`startup failure at ${failure} quits through acquired-host ownership even if the error dialog fails`, () => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-desktop-startup-"));
		try {
			const runtimePath = join(root, "app", "runtime", "server-runtime.ts");
			mkdirSync(join(root, "app", "runtime"), { recursive: true });
			writeFileSync(runtimePath, "export {};\n");
			const script = `
import { mock } from "bun:test";
const failure = ${JSON.stringify(failure)};
const calls = [];
const listeners = [];
mock.module(${JSON.stringify(runtimePath)}, () => ({
  startDesktopHost: async () => {
    calls.push("host");
    if (failure === "boot") throw new Error("boot failed");
    return { port: 12345, server: { shutdown: async () => {
      calls.push("shutdown-start");
      await Bun.sleep(10);
      calls.push("shutdown-end");
    } } };
  },
}));
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
  ApplicationMenu: { setApplicationMenu() {} },
  BrowserView: {},
  BrowserWindow: class {},
  PATHS: { RESOURCES_FOLDER: ${JSON.stringify(root)}, VIEWS_FOLDER: ${JSON.stringify(root)} },
  Updater: { getLocalInfo: async () => {
    calls.push("updates");
    throw new Error("update metadata failed");
  } },
  Utils: {
    paths: { userData: ${JSON.stringify(join(root, "user-data"))} },
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
console.log(JSON.stringify(calls));
`;
			const result = Bun.spawnSync([process.execPath, "--eval", script], {
				cwd: desktopDir,
				env: {
					...process.env,
					HOME: root,
					USERPROFILE: root,
					THINKRAIL_DESKTOP_USER_DATA: join(root, "user-data"),
					NODE_ENV: "test",
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.toString())).toEqual([
				"host",
				...(failure === "boot" ? [] : ["listener"]),
				...(failure === "updates" ? ["updates"] : []),
				"dialog",
				...(failure === "boot" ? [] : ["shutdown-start", "shutdown-end"]),
				"quit",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}
