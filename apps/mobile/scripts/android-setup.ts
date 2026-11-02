#!/usr/bin/env bun
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const APP_ROOT = join(import.meta.dir, "..");
const MANIFEST = join(APP_ROOT, "android/app/src/main/AndroidManifest.xml");
const RES = join(APP_ROOT, "android/app/src/main/res");
const URL_SCHEME = "thinkrail";
const LAUNCHER_ICONS = join(APP_ROOT, "../../packages/shared/assets/android");

if (!existsSync(join(APP_ROOT, "android"))) {
	if (!existsSync(join(APP_ROOT, "dist"))) await $`bun run build`.cwd(APP_ROOT);
	await $`bunx cap add android`.cwd(APP_ROOT);
}

const DEEP_LINK = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${URL_SCHEME}" />
            </intent-filter>
`;
const CLEARTEXT = 'android:usesCleartextTraffic="true"';
const CAMERA = '<uses-permission android:name="android.permission.CAMERA" />';

const edit = (
	manifest: string,
	done: string,
	anchor: string,
	insert: (anchor: string) => string,
) => {
	if (manifest.includes(done)) return manifest;
	if (!manifest.includes(anchor))
		throw new Error(`android-setup: AndroidManifest.xml lost "${anchor}"`);
	return manifest.replace(anchor, insert(anchor));
};

const original = readFileSync(MANIFEST, "utf8");
let manifest = edit(
	original,
	`android:scheme="${URL_SCHEME}"`,
	"        </activity>",
	(a) => `${DEEP_LINK}${a}`,
);
manifest = edit(manifest, CLEARTEXT, "<application", (a) => `${a}\n        ${CLEARTEXT}`);
manifest = edit(
	manifest,
	CAMERA,
	'<uses-permission android:name="android.permission.INTERNET" />',
	(a) => `${a}\n    ${CAMERA}`,
);
if (manifest !== original) {
	writeFileSync(MANIFEST, manifest);
	console.log(
		`android-setup: registered the ${URL_SCHEME}:// link, LAN cleartext and the camera permission`,
	);
}
console.log("android-setup: android/ is ready");

cpSync(LAUNCHER_ICONS, RES, { recursive: true });
console.log("android-setup: installed the ThinkRail launcher icons");
