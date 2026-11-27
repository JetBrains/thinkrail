import { randomBytes } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { ExtensionUsageError } from "./errors";

export interface LabelledPath {
	label: string;
	path: string;
}

export function toPosix(path: string, separator: string = sep): string {
	return separator === "/" ? path : path.split(separator).join("/");
}

function canonical(path: string): string {
	let existing = path;
	const rest: string[] = [];
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) break;
		rest.unshift(basename(existing));
		existing = parent;
	}
	return join(realpathSync(existing), ...rest);
}

function caseInsensitive(root: string): boolean {
	const lower = join(root, "package.json");
	const upper = join(root, "PACKAGE.JSON");
	if (!existsSync(upper)) return false;
	return statSync(lower).ino === statSync(upper).ino;
}

function overlap(a: string, b: string): "same" | "nested" | undefined {
	if (a === b) return "same";
	return a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`) ? "nested" : undefined;
}

function shown(root: string, path: string): string {
	const inside = toPosix(relative(root, path));
	return inside === "" || inside.startsWith("..") ? path : inside;
}

export function checkOutputPaths(
	root: string,
	inputs: readonly LabelledPath[],
	outputs: readonly LabelledPath[],
): void {
	const key = caseInsensitive(root) ? (path: string) => path.toLowerCase() : (path: string) => path;
	const rootKey = key(root);
	const resolvedInputs = inputs.map((input) => ({ ...input, key: key(canonical(input.path)) }));
	const resolvedOutputs = outputs.map((output) => {
		const real = canonical(output.path);
		return { ...output, real, key: key(real) };
	});
	for (const [index, output] of resolvedOutputs.entries()) {
		const name = `${output.label} (${shown(root, output.path)})`;
		if (!output.key.startsWith(`${rootKey}${sep}`)) {
			throw new ExtensionUsageError(
				`${name} resolves to ${output.real}, outside the package: the build writes only inside ${root}.`,
			);
		}
		if (existsSync(output.real) && statSync(output.real).isDirectory()) {
			throw new ExtensionUsageError(`${name} is a directory: point it at a file the build owns.`);
		}
		const others = [...resolvedInputs, ...resolvedOutputs.filter((_, other) => other !== index)];
		for (const other of others) {
			const relation = overlap(output.key, other.key);
			if (relation === undefined) continue;
			const target = `${other.label} (${shown(root, other.path)})`;
			throw new ExtensionUsageError(
				relation === "same"
					? `${name} would overwrite ${target}: the build's outputs must be files of their own, such as ./dist/web.js and ./dist/web.css.`
					: `${name} and ${target} overlap, one inside the other: the build's outputs must be files of their own, such as ./dist/web.js and ./dist/web.css.`,
			);
		}
	}
}

export function tempBeside(target: string): string {
	return join(
		dirname(target),
		`.${basename(target)}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`,
	);
}
