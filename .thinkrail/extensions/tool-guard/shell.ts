import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stripWrappers } from "./wrappers";

export interface SimpleCommand {
	words: string[];
	argv: string[];
	program: string;
	cwd: string | undefined;
	upstream: string[];
}

interface Segment {
	words: string[];
	piped: boolean;
	detached: boolean;
	substitutions: string[];
	group?: string;
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const REDIRECT = /^\d*[<>]/;

const closingParen = (line: string, from: number) => {
	let depth = 1;
	let quote: "'" | '"' | undefined;
	for (let i = from; i < line.length; i++) {
		const ch = line.charAt(i);
		if (quote) {
			if (ch === quote) quote = undefined;
			else if (ch === "\\" && quote === '"') i++;
		} else if (ch === "'" || ch === '"') quote = ch;
		else if (ch === "\\") i++;
		else if (ch === "(") depth++;
		else if (ch === ")" && --depth === 0) return i;
	}
	return line.length;
};

const closingBacktick = (line: string, from: number) => {
	for (let i = from; i < line.length; i++) {
		const ch = line.charAt(i);
		if (ch === "\\") i++;
		else if (ch === "`") return i;
	}
	return line.length;
};

const splitSegments = (line: string) => {
	const segments: Segment[] = [];
	let words: string[] = [];
	let substitutions: string[] = [];
	let word = "";
	let inWord = false;
	let quote: "'" | '"' | undefined;
	let piped = false;
	const endWord = () => {
		if (inWord) words.push(word);
		word = "";
		inWord = false;
	};
	const endSegment = ({ pipe, detached }: { pipe: boolean; detached: boolean }) => {
		endWord();
		if (words.length > 0)
			segments.push({ words, piped, detached: detached || piped, substitutions });
		words = [];
		substitutions = [];
		piped = pipe;
	};
	const substitute = (start: number, end: number, raw: string) => {
		substitutions.push(line.slice(start, end));
		word += raw;
		inWord = true;
		return end;
	};
	for (let i = 0; i < line.length; i++) {
		const ch = line.charAt(i);
		const next = line.charAt(i + 1);
		if (quote !== "'" && ch === "$" && next === "(") {
			const end = closingParen(line, i + 2);
			i = substitute(i + 2, end, line.slice(i, end + 1));
		} else if (quote !== "'" && ch === "`") {
			const end = closingBacktick(line, i + 1);
			i = substitute(i + 1, end, line.slice(i, end + 1));
		} else if (quote) {
			if (ch === quote) quote = undefined;
			else if (ch === "\\" && quote === '"' && i + 1 < line.length) word += line.charAt(++i);
			else word += ch;
		} else if (ch === "'" || ch === '"') {
			quote = ch;
			inWord = true;
		} else if (ch === "\\") {
			if (next !== "\n" && i + 1 < line.length) {
				word += next;
				inWord = true;
			}
			i++;
		} else if (ch === "#" && !inWord) {
			while (i + 1 < line.length && line.charAt(i + 1) !== "\n") i++;
		} else if (ch === "(" && !inWord) {
			endSegment({ pipe: piped, detached: false });
			const end = closingParen(line, i + 1);
			segments.push({
				words: [],
				piped,
				detached: true,
				substitutions: [],
				group: line.slice(i + 1, end),
			});
			i = end;
		} else if (ch === "(") {
			word += ch;
		} else if (ch === "|") {
			const or = next === "|";
			if (or || next === "&") i++;
			endSegment({ pipe: !or, detached: !or });
		} else if (ch === "&" && (word.endsWith(">") || word.endsWith("<"))) {
			word += ch;
		} else if (ch === "&" && next === "&") {
			i++;
			endSegment({ pipe: false, detached: false });
		} else if (ch === "&") {
			endSegment({ pipe: false, detached: true });
		} else if (ch === ";" || ch === "\n" || ch === ")") {
			endSegment({ pipe: false, detached: false });
		} else if (/\s/.test(ch)) {
			endWord();
		} else {
			word += ch;
			inWord = true;
		}
	}
	endSegment({ pipe: false, detached: false });
	return segments;
};

export const expandPath = (word: string, home: string) => {
	if (word === "~") return home;
	if (word.startsWith("~/")) return join(home, word.slice(2));
	const homeVar = /^(\$HOME|\$\{HOME\})(\/.*)?$/.exec(word);
	if (homeVar) return join(home, homeVar[2] ?? "");
	if (word.startsWith("~") || word.includes("$") || word.includes("`")) return undefined;
	return word;
};

export const isInside = (root: string, path: string) => {
	const rel = relative(root, path);
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

const changeDir = (target: string, cwd: string | undefined, home: string) => {
	const expanded = expandPath(target, home);
	if (expanded === undefined) return undefined;
	if (isAbsolute(expanded)) return resolve(expanded);
	return cwd === undefined ? undefined : resolve(cwd, expanded);
};

const nextCwd = (argv: readonly string[], cwd: string | undefined, home: string) => {
	const args = argv.slice(1);
	const dash = args.indexOf("--");
	const operands =
		dash >= 0 ? args.slice(dash + 1) : args.filter((arg) => arg === "-" || !arg.startsWith("-"));
	const target = operands[0];
	if (argv[0] === "popd") return undefined;
	if (target === undefined) return argv[0] === "cd" ? home : undefined;
	if (target === "-" || /^[+-]\d+$/.test(target)) return undefined;
	return changeDir(target, cwd, home);
};

const DIR_COMMANDS = new Set(["cd", "pushd", "popd"]);

const inlineScript = (argv: readonly string[]) => {
	const flag = argv.findIndex((word, index) => index > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word));
	return flag > 0 ? argv[flag + 1] : undefined;
};

export const parseCommandLine = ({
	line,
	cwd,
	home,
	upstream: inherited = [],
}: {
	line: string;
	cwd: string | undefined;
	home: string;
	upstream?: readonly string[];
}) => {
	const commands: SimpleCommand[] = [];
	let current = cwd;
	let upstream = [...inherited];
	splitSegments(line).forEach((segment, index) => {
		if (!segment.piped && index > 0) upstream = [];
		for (const inner of segment.substitutions)
			commands.push(...parseCommandLine({ line: inner, cwd: current, home }));
		if (segment.group !== undefined) {
			const grouped = parseCommandLine({ line: segment.group, cwd: current, home, upstream });
			commands.push(...grouped);
			upstream.push(...grouped.map((command) => command.program));
			return;
		}
		const { argv, chdir } = stripWrappers(segment.words);
		const commandCwd = chdir.reduce<string | undefined>(
			(dir, target) => changeDir(target, dir, home),
			current,
		);
		const program = argv[0] === undefined ? "" : basename(argv[0]);
		commands.push({
			words: segment.words,
			argv,
			program,
			cwd: commandCwd,
			upstream: [...upstream],
		});
		if (DIR_COMMANDS.has(program))
			current = segment.detached ? undefined : nextCwd(argv, commandCwd, home);
		const script = SHELLS.has(program) ? inlineScript(argv) : undefined;
		if (script !== undefined)
			commands.push(...parseCommandLine({ line: script, cwd: commandCwd, home }));
		upstream.push(program);
	});
	return commands;
};

export const isShell = (program: string) => SHELLS.has(program);

export const isRedirect = (word: string) => REDIRECT.test(word);
