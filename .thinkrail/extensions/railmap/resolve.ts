import { posix } from "node:path";
import { isRecord } from "./model";

export interface PackageInfo {
	name: string;
	exports: unknown;
	main?: string;
}

const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_TO_TS: Readonly<Record<string, readonly string[]>> = {
	".js": [".ts", ".tsx"],
	".jsx": [".tsx"],
	".mjs": [".mts"],
	".cjs": [".cts"],
};
const CONDITIONS = ["bun", "import", "default", "node", "require", "types"];

export const isCodeFile = (path: string) =>
	/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) && !path.endsWith(".d.ts");

export const isTestFile = (path: string) =>
	/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes("__tests__/");

const outside = (path: string) => path === ".." || path.startsWith("../");

export const resolvePath = (files: ReadonlySet<string>, raw: string) => {
	const base = posix.normalize(raw).replace(/\/$/, "");
	if (outside(base)) return undefined;
	if (files.has(base)) return base;
	const ext = posix.extname(base);
	for (const alt of JS_TO_TS[ext] ?? []) {
		const candidate = `${base.slice(0, -ext.length)}${alt}`;
		if (files.has(candidate)) return candidate;
	}
	for (const extension of CODE_EXTENSIONS)
		if (files.has(`${base}${extension}`)) return `${base}${extension}`;
	for (const extension of CODE_EXTENSIONS)
		if (files.has(`${base}/index${extension}`)) return `${base}/index${extension}`;
	return undefined;
};

const pick = (value: unknown): string | undefined => {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return pick(value[0]);
	if (!isRecord(value)) return undefined;
	for (const condition of CONDITIONS) {
		const picked = pick(value[condition]);
		if (picked) return picked;
	}
	return undefined;
};

const exportTarget = (exports: unknown, key: string) => {
	if (typeof exports === "string" || Array.isArray(exports))
		return key === "." ? pick(exports) : undefined;
	if (!isRecord(exports)) return undefined;
	const keys = Object.keys(exports);
	if (!keys.some((entry) => entry.startsWith("."))) return key === "." ? pick(exports) : undefined;
	if (key in exports) return pick(exports[key]);
	for (const pattern of keys) {
		const star = pattern.indexOf("*");
		if (star < 0) continue;
		const prefix = pattern.slice(0, star);
		const suffix = pattern.slice(star + 1);
		if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length < pattern.length - 1)
			continue;
		const matched = key.slice(prefix.length, key.length - suffix.length);
		return pick(exports[pattern])?.replace("*", matched);
	}
	return undefined;
};

export const packageExportFiles = (
	files: ReadonlySet<string>,
	dir: string,
	info: PackageInfo,
): string[] => {
	const targets = new Set<string>();
	const add = (target: string | undefined) => {
		const resolved = target ? resolvePath(files, posix.join(dir, target)) : undefined;
		if (resolved) targets.add(resolved);
	};
	if (isRecord(info.exports) && Object.keys(info.exports).some((key) => key.startsWith(".")))
		for (const [key, value] of Object.entries(info.exports))
			if (!key.includes("*")) add(pick(value));
	if (typeof info.exports === "string" || Array.isArray(info.exports)) add(pick(info.exports));
	add(info.main);
	return [...targets];
};

export const createResolver = (
	files: ReadonlySet<string>,
	packages: ReadonlyMap<string, PackageInfo>,
) => {
	const byName = new Map<string, { dir: string; info: PackageInfo }>();
	for (const [dir, info] of packages)
		if (!byName.has(info.name)) byName.set(info.name, { dir, info });

	const resolvePackage = (specifier: string) => {
		const parts = specifier.split("/");
		const nameLength = specifier.startsWith("@") ? 2 : 1;
		const name = parts.slice(0, nameLength).join("/");
		const found = byName.get(name);
		if (!found) return undefined;
		const sub = parts.slice(nameLength).join("/");
		const target =
			exportTarget(found.info.exports, sub ? `./${sub}` : ".") ??
			(sub ? undefined : found.info.main);
		return resolvePath(files, posix.join(found.dir, target ?? (sub || "index")));
	};

	return (fromFile: string, specifier: string) => {
		if (specifier.startsWith(".")) {
			const target = resolvePath(files, posix.join(posix.dirname(fromFile), specifier));
			return target ? { target, viaPackage: false } : undefined;
		}
		if (specifier.startsWith("/") || specifier.includes(":")) return undefined;
		const target = resolvePackage(specifier);
		return target ? { target, viaPackage: true } : undefined;
	};
};
