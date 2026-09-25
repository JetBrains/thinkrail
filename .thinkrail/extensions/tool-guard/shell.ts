import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

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
}

const BREAKS = new Set([";", "&", "\n", "(", ")", "`"]);
const WRAPPERS = new Set(["sudo", "doas", "command", "exec", "nohup", "time", "env"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const REDIRECT = /^\d*[<>]/;

const splitSegments = (line: string) => {
	const segments: Segment[] = [];
	let words: string[] = [];
	let word = "";
	let inWord = false;
	let quote: "'" | '"' | undefined;
	let piped = false;
	const endWord = () => {
		if (inWord) words.push(word);
		word = "";
		inWord = false;
	};
	const endSegment = (nextPiped: boolean) => {
		endWord();
		if (words.length > 0) segments.push({ words, piped });
		words = [];
		piped = nextPiped;
	};
	for (let i = 0; i < line.length; i++) {
		const ch = line.charAt(i);
		const next = line.charAt(i + 1);
		if (quote) {
			if (ch === quote) quote = undefined;
			else if (ch === "\\" && quote === '"' && i + 1 < line.length) word += line.charAt(++i);
			else word += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
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
		} else if (ch === "$" && next === "(") {
			endSegment(false);
			i++;
		} else if (ch === "|") {
			const or = next === "|";
			if (or || next === "&") i++;
			endSegment(!or);
		} else if (ch === "&" && (word.endsWith(">") || word.endsWith("<"))) {
			word += ch;
		} else if (BREAKS.has(ch)) {
			if (ch === "&" && next === "&") i++;
			endSegment(false);
		} else if (/\s/.test(ch)) {
			endWord();
		} else {
			word += ch;
			inWord = true;
		}
	}
	endSegment(false);
	return segments;
};

const stripWrappers = (words: readonly string[]) => {
	let i = 0;
	while (i < words.length) {
		const word = words[i] ?? "";
		if (ASSIGNMENT.test(word)) i++;
		else if (WRAPPERS.has(word)) {
			i++;
			while (i < words.length && (words[i] ?? "").startsWith("-")) i++;
		} else break;
	}
	return words.slice(i);
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

const nextCwd = (argv: readonly string[], cwd: string | undefined, home: string) => {
	const target = argv[1];
	if (target === undefined) return home;
	if (target === "-") return undefined;
	const expanded = expandPath(target, home);
	if (expanded === undefined) return undefined;
	if (isAbsolute(expanded)) return resolve(expanded);
	return cwd === undefined ? undefined : resolve(cwd, expanded);
};

const inlineScript = (argv: readonly string[]) => {
	const flag = argv.findIndex((word, index) => index > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word));
	return flag > 0 ? argv[flag + 1] : undefined;
};

export const parseCommandLine = ({
	line,
	cwd,
	home,
}: {
	line: string;
	cwd: string | undefined;
	home: string;
}) => {
	const commands: SimpleCommand[] = [];
	let current = cwd;
	let upstream: string[] = [];
	for (const segment of splitSegments(line)) {
		const argv = stripWrappers(segment.words);
		if (!segment.piped) upstream = [];
		const program = argv[0] === undefined ? "" : basename(argv[0]);
		const command: SimpleCommand = {
			words: segment.words,
			argv,
			program,
			cwd: current,
			upstream: [...upstream],
		};
		commands.push(command);
		if (program === "cd") current = nextCwd(argv, current, home);
		const script = SHELLS.has(program) ? inlineScript(argv) : undefined;
		if (script !== undefined)
			commands.push(...parseCommandLine({ line: script, cwd: current, home }));
		upstream.push(program);
	}
	return commands;
};

export const isShell = (program: string) => SHELLS.has(program);

export const isRedirect = (word: string) => REDIRECT.test(word);
