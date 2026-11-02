#!/usr/bin/env bun
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const APP_ROOT = join(import.meta.dir, "..");
const PLIST = join(APP_ROOT, "ios/App/App/Info.plist");
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
const URL_SCHEME = "thinkrail";
const LOCAL_NETWORK_REASON = "Connect to ThinkRail running on your computer";
const CAMERA_REASON = "Scan the pairing QR code ThinkRail prints on your computer";
const APP_ICON_SOURCE = join(APP_ROOT, "../../packages/shared/assets/icon-ios.png");
const APP_ICON_TARGET = join(
	APP_ROOT,
	"ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
);

if (!existsSync(join(APP_ROOT, "ios"))) {
	if (!existsSync(join(APP_ROOT, "dist"))) await $`bun run build`.cwd(APP_ROOT);
	await $`bunx cap add ios`.cwd(APP_ROOT);
}

const has = async (key: string): Promise<boolean> =>
	(await $`${PLIST_BUDDY} -c ${`Print :${key}`} ${PLIST}`.quiet().nothrow()).exitCode === 0;

if (!(await has("CFBundleURLTypes"))) {
	await $`${PLIST_BUDDY} -c ${"Add :CFBundleURLTypes array"} -c ${"Add :CFBundleURLTypes:0 dict"} -c ${"Add :CFBundleURLTypes:0:CFBundleURLName string ai.thinkrail.mobile"} -c ${"Add :CFBundleURLTypes:0:CFBundleURLSchemes array"} -c ${`Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ${URL_SCHEME}`} ${PLIST}`;
	console.log(`ios-setup: registered the ${URL_SCHEME}:// URL scheme`);
}
if (!(await has("NSLocalNetworkUsageDescription"))) {
	await $`${PLIST_BUDDY} -c ${`Add :NSLocalNetworkUsageDescription string ${LOCAL_NETWORK_REASON}`} ${PLIST}`;
	console.log("ios-setup: added the Local Network usage description");
}
if (!(await has("NSCameraUsageDescription"))) {
	await $`${PLIST_BUDDY} -c ${`Add :NSCameraUsageDescription string ${CAMERA_REASON}`} ${PLIST}`;
	console.log("ios-setup: added the Camera usage description");
}
console.log("ios-setup: ios/ is ready");

copyFileSync(APP_ICON_SOURCE, APP_ICON_TARGET);
console.log("ios-setup: installed the ThinkRail app icon");
