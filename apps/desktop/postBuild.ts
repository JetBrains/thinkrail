import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { channel, version } from "@thinkrail/shared/version";
import { windowsFileIdentity, windowsIconPath } from "@thinkrail/shared/windowsIdentity";
import { LINUX_DESKTOP_CATEGORIES, withDesktopCategories } from "./src/linuxDesktopIdentity";
import { brandWindowsExecutable } from "./src/windowsExecutableIdentity";

const desktopDir = import.meta.dir;

function bundleDirectory(): string {
	const buildDir = process.env.ELECTROBUN_BUILD_DIR;
	const appName = process.env.ELECTROBUN_APP_NAME;
	const buildEnvironment = process.env.ELECTROBUN_BUILD_ENV;
	if (!buildDir || !appName || !buildEnvironment) {
		throw new Error("postBuild requires build output metadata");
	}
	return join(buildDir, buildEnvironment === "stable" ? appName : `${appName}-${buildEnvironment}`);
}

if (process.env.ELECTROBUN_OS === "win") {
	const bundleDir = bundleDirectory();
	const icon = readFileSync(windowsIconPath);
	const identity = windowsFileIdentity({ version, channel });
	for (const [path, originalFilename] of [
		[join(bundleDir, "bin", "bun.exe"), "bun.exe"],
		[join(bundleDir, "bin", "launcher.exe"), "launcher.exe"],
		[join(bundleDir, "Resources", "uninstall"), "uninstall.exe"],
	] as const) {
		writeFileSync(
			path,
			brandWindowsExecutable(readFileSync(path), icon, identity, originalFilename),
		);
	}
	console.log(`branded Windows executables as ${identity.productName} ${identity.fileVersion}`);
}

if (process.env.ELECTROBUN_OS === "linux") {
	const bundleDir = bundleDirectory();
	const entries = readdirSync(bundleDir).filter((name) => name.endsWith(".desktop"));
	if (entries.length === 0) throw new Error(`no desktop entry in ${bundleDir}`);
	for (const name of entries) {
		const path = join(bundleDir, name);
		writeFileSync(
			path,
			withDesktopCategories(readFileSync(path, "utf8"), LINUX_DESKTOP_CATEGORIES),
		);
	}
	console.log(`filed the Linux desktop entry under ${LINUX_DESKTOP_CATEGORIES}`);
}

rmSync(join(desktopDir, ".stage"), { recursive: true, force: true });
