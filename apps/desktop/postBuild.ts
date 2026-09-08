import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { embedWindowsExecutableIcon } from "./src/windowsExecutableIcon";

const desktopDir = import.meta.dir;

if (process.env.ELECTROBUN_OS === "win") {
	const buildDir = process.env.ELECTROBUN_BUILD_DIR;
	const appName = process.env.ELECTROBUN_APP_NAME;
	const buildEnvironment = process.env.ELECTROBUN_BUILD_ENV;
	if (!buildDir || !appName || !buildEnvironment) {
		throw new Error("Windows postBuild requires build output metadata");
	}

	const bundleName = buildEnvironment === "stable" ? appName : `${appName}-${buildEnvironment}`;
	const uninstallerPath = join(buildDir, bundleName, "Resources", "uninstall");
	const iconPath = join(desktopDir, "assets", "icon.ico");
	const branded = embedWindowsExecutableIcon(readFileSync(uninstallerPath), readFileSync(iconPath));
	writeFileSync(uninstallerPath, branded);
	console.log("embedded Windows icon in uninstaller");
}

rmSync(join(desktopDir, ".stage"), { recursive: true, force: true });
