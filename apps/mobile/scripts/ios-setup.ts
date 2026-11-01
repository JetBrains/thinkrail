#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const APP_ROOT = join(import.meta.dir, "..");
const PLIST = join(APP_ROOT, "ios/App/App/Info.plist");
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
const URL_SCHEME = "thinkrail";
const LOCAL_NETWORK_REASON = "Connect to ThinkRail running on your computer";

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
console.log("ios-setup: ios/ is ready");
