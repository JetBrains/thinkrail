import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { version } from "@thinkrail/shared/version";
import manifest from "../package.json";

const desktopDir = resolve(import.meta.dir, "..");

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMetadata(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (cause) {
		throw new Error(`Electrobun SDK metadata is missing or corrupt: ${path}`, { cause });
	}
}

export function validateElectrobunProjection(devkitDir: string): void {
	const expectedVersion = manifest.devDependencies.electrobun;
	const projectionPath = join(devkitDir, "projection.json");
	const projection = readMetadata(projectionPath);
	if (
		!isRecord(projection) ||
		!isRecord(projection.product) ||
		projection.product.version !== expectedVersion
	) {
		throw new Error(`Expected Electrobun SDK version ${expectedVersion} in ${projectionPath}`);
	}
	const packagePath = join(devkitDir, "package.json");
	const sdkPackage = readMetadata(packagePath);
	if (!isRecord(sdkPackage) || sdkPackage.version !== expectedVersion) {
		throw new Error(`Expected Electrobun SDK version ${expectedVersion} in ${packagePath}`);
	}
}

export function electrobun(...args: string[]): void {
	const result = Bun.spawnSync([process.execPath, "x", "--no-install", "electrobun", ...args], {
		cwd: desktopDir,
		env: { ...process.env, THINKRAIL_DESKTOP_VERSION: version },
		stdout: "inherit",
		stderr: "inherit",
	});
	if (!result.success) throw new Error(`Electrobun ${args.join(" ")} exited ${result.exitCode}`);
}

export function prepareElectrobun(): void {
	electrobun("prepare");
	validateElectrobunProjection(join(desktopDir, ".hutch", "devkit"));
}
