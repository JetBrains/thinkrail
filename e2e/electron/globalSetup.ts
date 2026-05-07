import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Ensures the artifacts the Electron app needs at launch time exist:
 *
 *   1. PyInstaller backend bundle  (packaging/dist/bonsai-dir/bonsai)
 *   2. Compiled Electron main      (electron/dist-electron/main.js)
 *
 * Behavior is controlled by env vars:
 *   - default:                     build both if either is missing.
 *   - BONSAI_E2E_REBUILD=1         force a fresh PyInstaller + tsc build.
 *   - BONSAI_E2E_SKIP_BUILD=1      skip both checks; assume bundles are staged
 *                                  (CI sets this after downloading the
 *                                  bonsai-dir-* artifact).
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const ELECTRON_DIR = resolve(REPO_ROOT, "electron");
const BACKEND_BUNDLE = resolve(REPO_ROOT, "packaging", "dist", "bonsai-dir", "bonsai");
const ELECTRON_MAIN = resolve(ELECTRON_DIR, "dist-electron", "main.js");
const BUILD_SCRIPT = resolve(REPO_ROOT, "build_and_install.sh");

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[electron-e2e:setup] ${msg}`);
}

function run(cmd: string, args: string[], cwd: string): void {
  log(`$ ${cmd} ${args.join(" ")}  (cwd=${cwd})`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

export default async function globalSetup(): Promise<void> {
  if (process.env.BONSAI_E2E_SKIP_BUILD === "1") {
    log("BONSAI_E2E_SKIP_BUILD=1 — skipping build");
    if (!existsSync(BACKEND_BUNDLE)) {
      throw new Error(
        `BONSAI_E2E_SKIP_BUILD=1 was set but ${BACKEND_BUNDLE} is missing. ` +
          `Stage the PyInstaller bundle first or unset the variable.`,
      );
    }
    if (!existsSync(ELECTRON_MAIN)) {
      throw new Error(
        `BONSAI_E2E_SKIP_BUILD=1 was set but ${ELECTRON_MAIN} is missing. ` +
          `Run 'npm run build' in electron/ first or unset the variable.`,
      );
    }
    return;
  }

  const rebuild = process.env.BONSAI_E2E_REBUILD === "1";

  if (rebuild || !existsSync(BACKEND_BUNDLE)) {
    log(rebuild
      ? "BONSAI_E2E_REBUILD=1 — rebuilding PyInstaller bundle"
      : `${BACKEND_BUNDLE} missing — building PyInstaller bundle`);
    run(BUILD_SCRIPT, ["--no-install"], REPO_ROOT);
  } else {
    log(`reusing existing PyInstaller bundle (${BACKEND_BUNDLE})`);
    log(`  set BONSAI_E2E_REBUILD=1 to force a rebuild`);
  }

  if (!existsSync(resolve(ELECTRON_DIR, "node_modules"))) {
    log("electron/node_modules missing — running 'npm install'");
    run("npm", ["install", "--no-audit", "--no-fund"], ELECTRON_DIR);
  }

  if (rebuild || !existsSync(ELECTRON_MAIN)) {
    log("compiling electron/src — running 'npm run build'");
    run("npm", ["run", "build"], ELECTRON_DIR);
  } else {
    log(`reusing compiled electron main (${ELECTRON_MAIN})`);
  }
}
