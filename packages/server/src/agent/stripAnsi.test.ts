import { expect, test } from "bun:test";
import { stripAnsi } from "./stripAnsi";

const ESC = "\u001b";
const BEL = "\u0007";

test.each([
	["256-colour SGR", `${ESC}[38;5;208mcaveman${ESC}[0m level: FULL`, "caveman level: FULL"],
	["truecolor SGR", `${ESC}[38;2;0;200;0mok${ESC}[39m`, "ok"],
	["colon-separated SGR", `${ESC}[38:2::255:0:0mred${ESC}[m`, "red"],
	["cursor and erase", `${ESC}[2K${ESC}[1Gline`, "line"],
	["private mode", `${ESC}[?25lhidden${ESC}[?25h`, "hidden"],
	["CSI with an intermediate byte", `${ESC}[2 qcursor`, "cursor"],
	["8-bit CSI", "\u009b31mred\u009b0m", "red"],
	[
		"OSC 8 link ended by BEL",
		`${ESC}]8;;https://example.com/a,b+c!d${BEL}docs${ESC}]8;;${BEL} after`,
		"docs after",
	],
	[
		"OSC 8 link ended by ESC \\",
		`${ESC}]8;;https://example.com${ESC}\\docs${ESC}]8;;${ESC}\\`,
		"docs",
	],
	["OSC title with spaces and Unicode", `${ESC}]0;my title, ok! 中文${BEL}text`, "text"],
	["DCS", `${ESC}Pq#0;2;0;0;0${ESC}\\after`, "after"],
	["APC ended by 8-bit ST", `${ESC}_private\u009cafter`, "after"],
	["charset designation", `${ESC}(Bplain`, "plain"],
	["save and restore cursor", `${ESC}7a${ESC}8b`, "ab"],
	["single-byte escapes", `${ESC}Ma${ESC}Db`, "ab"],
	["8-bit DCS ended by 8-bit ST", "\u0090q#0\u009cafter", "after"],
	["lone 8-bit control", "a\u0085b", "ab"],
	["SOS and PM strings", `${ESC}Xsos${ESC}\\a${ESC}^pm${ESC}\\b`, "ab"],
	["BEL inside DCS does not end it", `${ESC}Pa${BEL}b${ESC}\\after`, "after"],
])("removes a complete sequence: %s", (_name, input, expected) => {
	expect(stripAnsi(input)).toBe(expected);
});

test.each([
	["bracket text without ESC", "array[0m] and [38;5;208m text"],
	["Unicode and emoji", "🚀 status · 中文 «ok»…"],
	["newlines and tabs", "line one\n\tline two"],
	["empty", ""],
])("leaves text that only looks similar unchanged: %s", (_name, input) => {
	expect(stripAnsi(input)).toBe(input);
});

test.each([
	["ESC at the end", `done${ESC}`, "done"],
	["unterminated OSC", `${ESC}]8;;https://example.com docs`, "]8;;https://example.com docs"],
	["CSI cut short", `${ESC}[38;5;208`, "[38;5;208"],
	["ESC before non-ASCII", `${ESC}ünder`, "ünder"],
	["OSC broken by another sequence", `${ESC}]0;title${ESC}[1mbold`, "]0;titlebold"],
	["OSC broken by an 8-bit CSI", `${ESC}]0;t\u009b1mbold${BEL}after`, `]0;tbold${BEL}after`],
])("drops only the control byte of an incomplete sequence: %s", (_name, input, expected) => {
	expect(stripAnsi(input)).toBe(expected);
});
