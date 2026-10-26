import { afterEach, expect, test } from "bun:test";
import { applyLocale, currentTranslator } from "@thinkrail/locales/react";
import {
	changesTabName,
	chatDisplayName,
	chatName,
	defaultTerminalIndex,
	defaultTerminalTitle,
	diffTabName,
	fallbackChatTitle,
	planDocumentName,
	terminalName,
} from "./tabNames";

afterEach(() => applyLocale("en", {}));

const GERMAN = {
	"store.chatTab.defaultName": "Unterhaltung",
	"store.terminal.defaultTitle": "Konsole {{index}}",
	"changes.tab.name": "Änderungen",
	"changes.tab.nameScoped": "Änderungen · {{suffix}}",
	"changes.scope.uncommittedSuffix": "nicht festgeschrieben",
	"chat.todo.planDocName": "Plan · {{title}}",
};

test("default names translate at render; a name set by the user or agent shows verbatim", () => {
	applyLocale("de", { de: GERMAN });
	const t = currentTranslator();
	expect(chatName(t, "")).toBe("Unterhaltung");
	expect(chatName(t, "  ")).toBe("Unterhaltung");
	expect(chatName(t, "Fix login")).toBe("Fix login");
	expect(terminalName(t, defaultTerminalTitle(3))).toBe("Konsole 3");
	expect(terminalName(t, "dev server")).toBe("dev server");
	expect(planDocumentName(t, "")).toBe("Plan · Unterhaltung");
	expect(planDocumentName(t, "Fix login")).toBe("Plan · Fix login");
});

test("terminal defaults are a language-neutral pattern that numbering reads back", () => {
	expect(defaultTerminalTitle(2)).toBe("Terminal 2");
	expect(defaultTerminalIndex("Terminal 12")).toBe(12);
	expect(defaultTerminalIndex("Terminal")).toBeNull();
	expect(defaultTerminalIndex("My Terminal 2")).toBeNull();
});

test("Changes and diff tab names tag every non-default scope in the current language", () => {
	const en = currentTranslator();
	expect(changesTabName(en, { kind: "branch" })).toBe("Changes");
	expect(changesTabName(en, { kind: "uncommitted" })).toBe("Changes · uncommitted");
	expect(changesTabName(en, { kind: "commit", sha: "abc1234567" })).toBe("Changes · abc1234");
	expect(diffTabName(en, { kind: "branch" }, "src/a.ts")).toBe("a.ts");
	expect(diffTabName(en, { kind: "uncommitted" }, "src/a.ts")).toBe("a.ts · uncommitted");
	expect(diffTabName(en, { kind: "pinned", baseRef: "abc1234567" }, "src/a.ts")).toBe(
		"a.ts · abc1234",
	);
	const turn = { kind: "turn", id: "s1:1", baseTree: "a", headTree: "b", startedAt: 1 } as const;
	expect(changesTabName(en, turn)).toMatch(/^Changes · turn /);
	expect(diffTabName(en, turn, "src/a.ts")).toMatch(/^a\.ts · turn /);

	applyLocale("de", { de: GERMAN });
	const de = currentTranslator();
	expect(changesTabName(de, { kind: "uncommitted" })).toBe("Änderungen · nicht festgeschrieben");
	expect(diffTabName(de, { kind: "uncommitted" }, "src/a.ts")).toBe("a.ts · nicht festgeschrieben");
});

test("an unnamed chat shows its first prompt's head, cut at a word boundary; a real name always wins", () => {
	const t = currentTranslator();
	expect(fallbackChatTitle("Fix the login redirect")).toBe("Fix the login redirect");
	expect(
		fallbackChatTitle("Please refactor the authentication module so that tokens refresh quietly"),
	).toBe("Please refactor the authentication module so…");
	expect(fallbackChatTitle("x".repeat(60))).toBe(`${"x".repeat(48)}…`);
	expect(fallbackChatTitle("  spaced   out  \n next")).toBe("spaced out next");
	expect(fallbackChatTitle('<review scope="branch">')).toBeUndefined();
	expect(fallbackChatTitle("")).toBeUndefined();
	expect(fallbackChatTitle(undefined)).toBeUndefined();
	expect(chatDisplayName(t, "Named", "Fix the login redirect")).toBe("Named");
	expect(chatDisplayName(t, "", "Fix the login redirect")).toBe("Fix the login redirect");
	expect(chatDisplayName(t, "", undefined)).toBe("Chat");
});
