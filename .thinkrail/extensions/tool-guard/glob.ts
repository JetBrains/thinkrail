import { basename, isAbsolute, relative } from "node:path";
import { expandPath } from "./shell";

const SPECIAL = /[.+^${}()|[\]\\]/;

export const globToRegExp = (glob: string) => {
	let source = "";
	for (let i = 0; i < glob.length; i++) {
		const ch = glob.charAt(i);
		if (ch === "*" && glob.charAt(i + 1) === "*") {
			const slash = glob.charAt(i + 2) === "/";
			source += slash ? "(?:.*/)?" : ".*";
			i += slash ? 2 : 1;
		} else if (ch === "*") source += "[^/]*";
		else if (ch === "?") source += "[^/]";
		else source += SPECIAL.test(ch) ? `\\${ch}` : ch;
	}
	return new RegExp(`^${source}$`);
};

export const pathMatcher = ({
	pattern,
	root,
	home,
}: {
	pattern: string;
	root: string;
	home: string;
}) => {
	const expanded = expandPath(pattern, home) ?? pattern;
	const regex = globToRegExp(expanded);
	if (!expanded.includes("/")) return (path: string) => regex.test(basename(path));
	if (isAbsolute(expanded)) return (path: string) => regex.test(path);
	return (path: string) => regex.test(relative(root, path));
};
