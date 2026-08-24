const STARTUP_MARK_LINES = [
	"THINKRAIL·THINKRAIL·THIN RAIL·THINK",
	"INKRAIL·THINKRAIL·THINKR IL·THINKRAI",
	"                                 IL·T",
	"AIL·THINKRAI ·THINKRAIL·THINKRAI  THIN",
	"L·THINKRAIL· HINKRAIL·THINKRAIL·T INKR",
	"        L·TH                 ·THI  RAI",
	"        THIN RAIL            HINK  IL·",
	"        INKR IL·T            NKRA  ·TH",
	"        KRAI ·THI            RAIL  HIN",
	"        AIL· HINK AIL·THINKRAIL·  INKR",
	"        L·TH NKRAIL·THINKRAIL·TH  KRAI",
	"        THIN RAIL·THINKRAIL·T   KRAIL",
	"        INKR IL·TH  KRAIL·TH  KRAIL·",
	"        KRAI ·THI  RAIL·THINK  IL·TH",
	"        AIL· HINK  IL·THINKRAI  THINK",
	"        L·TH NKRA  ·TH     IL·T  NKRAI",
	"        THIN RAIL THIN      THIN  AIL·T",
	"        INKR IL·T INKR       NKRA  ·THIN",
	"        KRAI ·THI KRAI        AIL·  INKRA",
	"        AIL· HINK AIL·         ·THI  RAIL·",
] as const;

const MARK_WIDTH = 42;
const SIDE_BY_SIDE_MIN_COLUMNS = 72;
const LOCKUP_GAP = 6;
const DEFAULT_COLUMNS = 80;
const ESC = "\x1b[";
const RESET = `${ESC}0m`;

type Tone = "default" | "green" | "brightGreen" | "dimGreen" | "muted";

interface Segment {
	text: string;
	tone: Tone;
}

export type StartupMarkStatus = "starting" | "host ready";

export interface RenderStartupMarkOptions {
	status: StartupMarkStatus;
	endpoint: string;
	columns?: number;
	color?: boolean;
}

export interface StartupMarkOutput {
	readonly isTTY?: boolean;
	readonly columns?: number;
	write(chunk: string): unknown;
}

export type StartupMarkEnvironment = Readonly<Record<string, string | undefined>>;

const ANSI_BY_TONE: Record<Tone, string> = {
	default: RESET,
	green: `${ESC}32m`,
	brightGreen: `${ESC}92m`,
	dimGreen: `${ESC}2;32m`,
	muted: `${ESC}0;2m`,
};

function appendSegment(segments: Segment[], text: string, tone: Tone): void {
	if (text.length === 0) return;
	const previous = segments.at(-1);
	if (previous?.tone === tone) previous.text += text;
	else segments.push({ text, tone });
}

function markLineSegments(line: string, row: number): Segment[] {
	const segments: Segment[] = [];
	for (const [column, character] of Array.from(line).entries()) {
		const tone: Tone =
			character === " "
				? "default"
				: character === "·"
					? "dimGreen"
					: (column + row) % 7 === 0
						? "brightGreen"
						: "green";
		appendSegment(segments, character, tone);
	}
	return segments;
}

function visibleLength(segments: readonly Segment[]): number {
	return segments.reduce((length, segment) => length + Array.from(segment.text).length, 0);
}

function fitSegments(segments: readonly Segment[], width: number): Segment[] {
	if (width <= 0) return [];
	if (visibleLength(segments) <= width) return segments.map((segment) => ({ ...segment }));

	const fitted: Segment[] = [];
	let remaining = width;
	for (const segment of segments) {
		if (remaining <= 1) break;
		const characters = Array.from(segment.text);
		const take = Math.min(characters.length, remaining - 1);
		appendSegment(fitted, characters.slice(0, take).join(""), segment.tone);
		remaining -= take;
	}
	appendSegment(fitted, "…", fitted.at(-1)?.tone ?? "default");
	return fitted;
}

function plainEndpoint(endpoint: string): string {
	return endpoint.replace(/^https?:\/\//u, "").replace(/\/$/u, "");
}

interface IdentityLines {
	product: Segment[];
	description: Segment[];
	status: Segment[];
	endpoint: Segment[];
}

function identityLines(status: StartupMarkStatus, endpoint: string): IdentityLines {
	return {
		product: [{ text: "THINKRAIL", tone: "brightGreen" }],
		description: [{ text: "worktree IDE for pi", tone: "muted" }],
		status: [
			{ text: "● ", tone: "brightGreen" },
			{ text: status, tone: "muted" },
		],
		endpoint: [{ text: `  ${plainEndpoint(endpoint)}`, tone: "dimGreen" }],
	};
}

function wideLayout(status: StartupMarkStatus, endpoint: string, columns: number): Segment[][] {
	const mark = STARTUP_MARK_LINES.map(markLineSegments);
	const identity = identityLines(status, endpoint);
	const rightWidth = columns - MARK_WIDTH - LOCKUP_GAP;
	const rightByRow = new Map<number, Segment[]>([
		[6, fitSegments(identity.product, rightWidth)],
		[7, fitSegments(identity.description, rightWidth)],
		[10, fitSegments(identity.status, rightWidth)],
		[11, fitSegments(identity.endpoint, rightWidth)],
	]);

	return mark.map((line, row) => {
		const right = rightByRow.get(row);
		if (!right) return line;
		const padding = " ".repeat(MARK_WIDTH - visibleLength(line) + LOCKUP_GAP);
		return [...line, { text: padding, tone: "default" }, ...right];
	});
}

function stackedLayout(status: StartupMarkStatus, endpoint: string, columns: number): Segment[][] {
	const identity = identityLines(status, endpoint);
	const fittedIdentity = [
		fitSegments(identity.product, columns),
		fitSegments(identity.description, columns),
		[],
		fitSegments(identity.status, columns),
		fitSegments(identity.endpoint, columns),
	];
	if (columns < MARK_WIDTH) return fittedIdentity;
	return [...STARTUP_MARK_LINES.map(markLineSegments), [], ...fittedIdentity];
}

function normalizedColumns(columns: number | undefined): number {
	if (columns === undefined || !Number.isFinite(columns) || columns <= 0) return DEFAULT_COLUMNS;
	return Math.floor(columns);
}

function renderLine(segments: readonly Segment[], color: boolean): string {
	if (!color) return segments.map((segment) => segment.text).join("");
	if (segments.length === 0) return "";
	return `${segments.map((segment) => `${ANSI_BY_TONE[segment.tone]}${segment.text}`).join("")}${RESET}`;
}

export function renderStartupMark(options: RenderStartupMarkOptions): string {
	const columns = normalizedColumns(options.columns);
	const lines =
		columns >= SIDE_BY_SIDE_MIN_COLUMNS
			? wideLayout(options.status, options.endpoint, columns)
			: stackedLayout(options.status, options.endpoint, columns);
	return `${lines.map((line) => renderLine(line, options.color ?? false)).join("\n")}\n\n`;
}

export function shouldPrintStartupMark(output: Pick<StartupMarkOutput, "isTTY">): boolean {
	return output.isTTY === true;
}

export function printStartupMark(
	options: Omit<RenderStartupMarkOptions, "columns" | "color">,
	output: StartupMarkOutput = process.stdout,
	environment: StartupMarkEnvironment = process.env,
): boolean {
	if (!shouldPrintStartupMark(output)) return false;
	const color = environment.NO_COLOR === undefined && environment.TERM?.toLowerCase() !== "dumb";
	output.write(
		renderStartupMark({
			...options,
			color,
			...(output.columns === undefined ? {} : { columns: output.columns }),
		}),
	);
	return true;
}
