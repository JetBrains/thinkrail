import { createHash } from "node:crypto";
import {
	closeSync,
	cpSync,
	existsSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readlinkSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
} from "node:fs";
import { basename, dirname, join, posix, resolve, sep } from "node:path";

export type MacosPackageChannel = "canary" | "stable";

export interface MacosArtifactNames {
	readonly appBundle: string;
	readonly appArchive: string;
	readonly dmg: string;
	readonly volume: string;
}

export interface MacosAppSnapshotEntry {
	readonly path: string;
	readonly type: "directory" | "file" | "symlink";
	readonly mode: number;
	readonly size?: number;
	readonly sha256?: string;
	readonly target?: string;
}

export type MacosAppBundleSnapshot = readonly MacosAppSnapshotEntry[];

export type MacosPackageCommandRunner = (command: readonly string[]) => void;

export interface MacosPostPackageOptions {
	readonly zstdPath?: string;
	readonly tarPath?: string;
	readonly hdiutilPath?: string;
	readonly runCommand?: MacosPackageCommandRunner;
}

const appName = "ThinkRail";
const macosPlatform = "macos-arm64";
const requiredDirectories = [
	"Contents",
	"Contents/Frameworks",
	"Contents/MacOS",
	"Contents/Resources",
	"Contents/Resources/app",
	"Contents/Resources/app/bun",
	"Contents/Resources/app/runtime",
	"Contents/Resources/app/runtime/skills",
	"Contents/Resources/app/views",
	"Contents/Resources/app/views/web",
	"Contents/Resources/app/views/web/assets",
] as const;
const requiredFiles = [
	"Contents/Info.plist",
	"Contents/MacOS/bspatch",
	"Contents/MacOS/bun",
	"Contents/MacOS/launcher",
	"Contents/MacOS/libasar.dylib",
	"Contents/MacOS/libNativeWrapper.dylib",
	"Contents/MacOS/zig-zstd",
	"Contents/Resources/AppIcon.icns",
	"Contents/Resources/build.json",
	"Contents/Resources/main.js",
	"Contents/Resources/version.json",
	"Contents/Resources/app/bun/index.js",
	"Contents/Resources/app/runtime/librust_pty_arm64.dylib",
	"Contents/Resources/app/runtime/macos-trash",
	"Contents/Resources/app/runtime/preload.js",
	"Contents/Resources/app/runtime/server-runtime.ts",
	"Contents/Resources/app/runtime/windows-trash.exe",
	"Contents/Resources/app/views/web/index.html",
] as const;
const requiredExecutables = [
	"Contents/MacOS/bspatch",
	"Contents/MacOS/bun",
	"Contents/MacOS/launcher",
	"Contents/MacOS/libasar.dylib",
	"Contents/MacOS/libNativeWrapper.dylib",
	"Contents/MacOS/zig-zstd",
	"Contents/Resources/app/runtime/macos-trash",
] as const;
const tarBlockSize = 512;
const tarMetadataLimit = 1024 * 1024;

export function isMacosPackageChannel(value: string): value is MacosPackageChannel {
	return value === "canary" || value === "stable";
}

export function macosArtifactNames(channel: MacosPackageChannel): MacosArtifactNames {
	const stem = channel === "stable" ? appName : `${appName}-${channel}`;
	const prefix = `${channel}-${macosPlatform}`;
	return {
		appBundle: `${stem}.app`,
		appArchive: `${prefix}-${stem}.app.tar.zst`,
		dmg: `${prefix}-${stem}.dmg`,
		volume: stem,
	};
}

function requireDirectory(path: string, label: string): void {
	if (!existsSync(path) || !lstatSync(path).isDirectory()) {
		throw new Error(`${label} is not a directory: ${path}`);
	}
}

function requireRegularFile(path: string, label: string): void {
	if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
	const entry = lstatSync(path);
	if (!entry.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
	if (entry.size === 0) throw new Error(`${label} is empty: ${path}`);
}

function sortedEntries(path: string): string[] {
	return readdirSync(path).sort();
}

function hasFiles(path: string): boolean {
	for (const name of readdirSync(path)) {
		const entry = lstatSync(join(path, name));
		if (entry.isFile()) return true;
		if (entry.isDirectory() && hasFiles(join(path, name))) return true;
	}
	return false;
}

function relativeDisplay(root: string, path: string): string {
	return path
		.slice(root.length + 1)
		.split(sep)
		.join("/");
}

export function validateExpandedMacosApp(appPath: string, channel: MacosPackageChannel): void {
	const expected = macosArtifactNames(channel).appBundle;
	if (basename(appPath) !== expected) {
		throw new Error(`macOS app must be named ${expected}: ${appPath}`);
	}
	requireDirectory(appPath, "macOS app bundle");
	const resources = join(appPath, "Contents", "Resources");
	const metadata = join(resources, "metadata.json");
	if (existsSync(metadata)) {
		throw new Error(`macOS app contains legacy Electrobun extractor metadata: ${metadata}`);
	}
	if (existsSync(resources)) {
		const pending = [resources];
		while (pending.length > 0) {
			const directory = pending.pop();
			if (!directory) break;
			for (const name of readdirSync(directory)) {
				const path = join(directory, name);
				const entry = lstatSync(path);
				if (entry.isDirectory()) pending.push(path);
				if (entry.isFile() && name.endsWith(".tar.zst")) {
					throw new Error(
						`macOS app contains a legacy Electrobun payload archive: ${relativeDisplay(appPath, path)}`,
					);
				}
			}
		}
	}
	for (const route of requiredDirectories) {
		requireDirectory(join(appPath, ...route.split("/")), `required macOS app directory ${route}`);
	}
	for (const route of requiredFiles) {
		requireRegularFile(join(appPath, ...route.split("/")), `required macOS app file ${route}`);
	}
	for (const route of requiredExecutables) {
		const path = join(appPath, ...route.split("/"));
		if ((statSync(path).mode & 0o111) === 0) {
			throw new Error(`required macOS app executable is not executable: ${route}`);
		}
	}
	for (const route of [
		"Contents/Resources/app/runtime/skills",
		"Contents/Resources/app/views/web/assets",
	] as const) {
		const path = join(appPath, ...route.split("/"));
		if (!hasFiles(path)) throw new Error(`required macOS app directory is empty: ${route}`);
	}
}

export function validateExpandedMacosPackage(
	packageRoot: string,
	channel: MacosPackageChannel,
): string {
	requireDirectory(packageRoot, "macOS package root");
	const names = macosArtifactNames(channel);
	const expected = ["Applications", names.appBundle].sort();
	const actual = sortedEntries(packageRoot);
	if (
		actual.length !== expected.length ||
		actual.some((entry, index) => entry !== expected[index])
	) {
		throw new Error(
			`macOS package root must contain exactly ${expected.join(", ")}; found ${actual.join(", ") || "nothing"}`,
		);
	}
	const applications = join(packageRoot, "Applications");
	if (!lstatSync(applications).isSymbolicLink() || readlinkSync(applications) !== "/Applications") {
		throw new Error("macOS package Applications entry must link to /Applications");
	}
	const appPath = join(packageRoot, names.appBundle);
	validateExpandedMacosApp(appPath, channel);
	return appPath;
}

function hashFile(path: string): string {
	const hash = createHash("sha256");
	const descriptor = openSync(path, "r");
	const buffer = Buffer.allocUnsafe(1024 * 1024);
	try {
		while (true) {
			const length = readSync(descriptor, buffer, 0, buffer.length, null);
			if (length === 0) break;
			hash.update(buffer.subarray(0, length));
		}
	} finally {
		closeSync(descriptor);
	}
	return hash.digest("hex");
}

export function snapshotMacosAppBundle(appPath: string): MacosAppBundleSnapshot {
	requireDirectory(appPath, "macOS app bundle");
	const snapshot: MacosAppSnapshotEntry[] = [];
	const visit = (path: string, route: string): void => {
		const entry = lstatSync(path);
		const mode = entry.mode & 0o777;
		if (entry.isDirectory()) {
			snapshot.push({ path: route, type: "directory", mode });
			for (const name of sortedEntries(path)) {
				visit(join(path, name), route === "." ? name : `${route}/${name}`);
			}
			return;
		}
		if (entry.isFile()) {
			snapshot.push({
				path: route,
				type: "file",
				mode,
				size: entry.size,
				sha256: hashFile(path),
			});
			return;
		}
		if (entry.isSymbolicLink()) {
			snapshot.push({ path: route, type: "symlink", mode, target: readlinkSync(path) });
			return;
		}
		throw new Error(`unsupported macOS app bundle entry: ${route}`);
	};
	visit(appPath, ".");
	return snapshot;
}

function parseTarNumber(field: Buffer, label: string): number {
	if ((field[0] ?? 0) & 0x80) throw new Error(`tar archive uses unsupported ${label} encoding`);
	const text = field.toString("ascii").replaceAll("\0", "").trim();
	if (!/^[0-7]+$/.test(text)) throw new Error(`tar archive has invalid ${label}`);
	const value = Number.parseInt(text, 8);
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error(`tar archive has invalid ${label}`);
	return value;
}

function tarText(field: Buffer): string {
	const end = field.indexOf(0);
	return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function validateTarChecksum(header: Buffer): void {
	const expected = parseTarNumber(header.subarray(148, 156), "checksum");
	let actual = 0;
	for (let index = 0; index < header.length; index += 1) {
		actual += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
	}
	if (actual !== expected) throw new Error("tar archive has an invalid header checksum");
}

function readExactly(descriptor: number, length: number, position: number): Buffer {
	const value = Buffer.alloc(length);
	let offset = 0;
	while (offset < length) {
		const count = readSync(descriptor, value, offset, length - offset, position + offset);
		if (count === 0) throw new Error("tar archive is truncated");
		offset += count;
	}
	return value;
}

function parsePax(payload: Buffer): Readonly<Record<string, string>> {
	const values: Record<string, string> = {};
	let offset = 0;
	while (offset < payload.length) {
		const separator = payload.indexOf(32, offset);
		if (separator === -1) throw new Error("tar archive has invalid pax metadata");
		const length = Number.parseInt(payload.subarray(offset, separator).toString("ascii"), 10);
		if (
			!Number.isSafeInteger(length) ||
			length <= separator - offset ||
			offset + length > payload.length
		) {
			throw new Error("tar archive has invalid pax metadata");
		}
		const record = payload.subarray(separator + 1, offset + length);
		if (record[record.length - 1] !== 10) throw new Error("tar archive has invalid pax metadata");
		const content = record.subarray(0, -1).toString("utf8");
		const equals = content.indexOf("=");
		if (equals <= 0) throw new Error("tar archive has invalid pax metadata");
		values[content.slice(0, equals)] = content.slice(equals + 1);
		offset += length;
	}
	return values;
}

function normalizeTarEntry(rawPath: string): string {
	if (!rawPath || rawPath.includes("\0") || posix.isAbsolute(rawPath)) {
		throw new Error(`tar archive contains an unsafe path: ${JSON.stringify(rawPath)}`);
	}
	const components = rawPath.split("/");
	if (components.includes("..")) {
		throw new Error(`tar archive contains an unsafe path: ${JSON.stringify(rawPath)}`);
	}
	const normalized = posix.normalize(rawPath);
	if (normalized === "." || normalized.startsWith("../")) {
		throw new Error(`tar archive contains an unsafe path: ${JSON.stringify(rawPath)}`);
	}
	return normalized.replace(/\/$/, "");
}

function inspectTarArchive(tarPath: string, expectedRoot?: string): void {
	requireRegularFile(tarPath, "tar archive");
	const descriptor = openSync(tarPath, "r");
	const archiveSize = fstatSync(descriptor).size;
	const paths = new Set<string>();
	const roots = new Set<string>();
	let position = 0;
	let nextPax: Readonly<Record<string, string>> = {};
	let globalPax: Readonly<Record<string, string>> = {};
	let longPath: string | undefined;
	let longLink: string | undefined;
	try {
		while (position < archiveSize) {
			if (position + tarBlockSize > archiveSize) throw new Error("tar archive is truncated");
			const header = readExactly(descriptor, tarBlockSize, position);
			position += tarBlockSize;
			if (header.every((byte) => byte === 0)) break;
			validateTarChecksum(header);
			const size = parseTarNumber(header.subarray(124, 136), "entry size");
			const paddedSize = Math.ceil(size / tarBlockSize) * tarBlockSize;
			if (position + paddedSize > archiveSize) throw new Error("tar archive is truncated");
			const type = String.fromCharCode(header[156] ?? 0);
			const prefix = tarText(header.subarray(345, 500));
			const headerPath = [prefix, tarText(header.subarray(0, 100))].filter(Boolean).join("/");
			if (type === "x" || type === "g" || type === "L" || type === "K") {
				if (size > tarMetadataLimit) throw new Error("tar archive metadata is too large");
				const payload = readExactly(descriptor, size, position);
				if (type === "x") nextPax = parsePax(payload);
				if (type === "g") globalPax = { ...globalPax, ...parsePax(payload) };
				if (type === "L") longPath = tarText(payload);
				if (type === "K") longLink = tarText(payload);
				position += paddedSize;
				continue;
			}
			if (type === "1" || type === "2") {
				const target =
					nextPax.linkpath ?? globalPax.linkpath ?? longLink ?? tarText(header.subarray(157, 257));
				throw new Error(
					`tar archive contains an unsupported link: ${JSON.stringify(headerPath)} -> ${JSON.stringify(target)}`,
				);
			}
			if (type !== "\0" && type !== "0" && type !== "5" && type !== "7") {
				throw new Error(`tar archive contains an unsupported entry type: ${JSON.stringify(type)}`);
			}
			const path = normalizeTarEntry(nextPax.path ?? globalPax.path ?? longPath ?? headerPath);
			if (paths.has(path)) throw new Error(`tar archive contains a duplicate path: ${path}`);
			paths.add(path);
			roots.add(path.split("/")[0] ?? path);
			nextPax = {};
			longPath = undefined;
			longLink = undefined;
			position += paddedSize;
		}
	} finally {
		closeSync(descriptor);
	}
	if (paths.size === 0) throw new Error("tar archive contains no entries");
	if (expectedRoot) {
		const normalizedRoot = normalizeTarEntry(expectedRoot);
		const foundRoots = [...roots].sort();
		if (foundRoots.length !== 1 || foundRoots[0] !== normalizedRoot) {
			throw new Error(
				`tar archive must contain exactly the ${normalizedRoot} root; found ${foundRoots.join(", ")}`,
			);
		}
	}
}

function defaultRunCommand(command: readonly string[]): void {
	const result = Bun.spawnSync([...command], {
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	if (!result.success) throw new Error(`${command[0] ?? "command"} exited ${result.exitCode}`);
}

export function extractTarSafely(
	tarPath: string,
	destination: string,
	expectedRoot?: string,
	tarExecutable = "/usr/bin/tar",
	runCommand: MacosPackageCommandRunner = defaultRunCommand,
): void {
	requireDirectory(destination, "tar extraction destination");
	const entries = sortedEntries(destination);
	if (entries.length > 0) {
		throw new Error(`tar extraction destination is not empty: ${destination}`);
	}
	inspectTarArchive(tarPath, expectedRoot);
	runCommand([tarExecutable, "-xf", resolve(tarPath), "-C", resolve(destination)]);
}

function resolveElectrobunZstd(desktopDir: string): string {
	let directory = resolve(desktopDir);
	while (true) {
		const candidate = join(directory, "node_modules", "electrobun", "dist-macos-arm64", "zig-zstd");
		if (existsSync(candidate) && lstatSync(candidate).isFile()) return candidate;
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	throw new Error("Electrobun's bundled macOS ARM64 zig-zstd was not found");
}

export function postPackageExpandedMacosDmg(
	desktopDir: string,
	channel: MacosPackageChannel,
	options: MacosPostPackageOptions = {},
): string {
	const root = resolve(desktopDir);
	const artifacts = join(root, "artifacts");
	requireDirectory(artifacts, "Electrobun artifact directory");
	const names = macosArtifactNames(channel);
	const archivePath = join(artifacts, names.appArchive);
	const dmgPath = join(artifacts, names.dmg);
	requireRegularFile(archivePath, "Electrobun app archive");
	requireRegularFile(dmgPath, "Electrobun wrapper DMG");
	const zstdPath = options.zstdPath ?? resolveElectrobunZstd(root);
	const tarExecutable = options.tarPath ?? "/usr/bin/tar";
	const hdiutilPath = options.hdiutilPath ?? "/usr/bin/hdiutil";
	const runCommand = options.runCommand ?? defaultRunCommand;
	requireRegularFile(zstdPath, "Electrobun zig-zstd");
	const temporary = mkdtempSync(join(artifacts, ".macos-package-"));
	const tarPath = join(temporary, `${names.appBundle}.tar`);
	const extraction = join(temporary, "extracted");
	const staging = join(temporary, "dmg-root");
	const temporaryDmg = join(temporary, names.dmg);
	mkdirSync(extraction);
	mkdirSync(staging);
	try {
		runCommand([zstdPath, "decompress", "-i", archivePath, "-o", tarPath]);
		requireRegularFile(tarPath, "decompressed Electrobun tar archive");
		extractTarSafely(tarPath, extraction, names.appBundle, tarExecutable, runCommand);
		const extractedEntries = sortedEntries(extraction);
		if (extractedEntries.length !== 1 || extractedEntries[0] !== names.appBundle) {
			throw new Error(
				`Electrobun app archive must extract exactly ${names.appBundle}; found ${extractedEntries.join(", ") || "nothing"}`,
			);
		}
		const extractedApp = join(extraction, names.appBundle);
		validateExpandedMacosApp(extractedApp, channel);
		cpSync(extractedApp, join(staging, names.appBundle), { recursive: true });
		symlinkSync("/Applications", join(staging, "Applications"));
		validateExpandedMacosPackage(staging, channel);
		runCommand([
			hdiutilPath,
			"create",
			"-volname",
			names.volume,
			"-srcfolder",
			staging,
			"-ov",
			"-format",
			"ULFO",
			temporaryDmg,
		]);
		requireRegularFile(temporaryDmg, "expanded macOS DMG");
		renameSync(temporaryDmg, dmgPath);
		return dmgPath;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}
