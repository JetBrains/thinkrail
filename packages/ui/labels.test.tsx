import { afterEach, expect, test } from "bun:test";
import { applyLocale, useT } from "@thinkrail/locales/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Command, CommandInput, CommandList } from "./command";
import { ToastProvider, ToastViewport } from "./toast";

afterEach(() => applyLocale("en", {}));

test("library defaults for the suggestion list and toast region follow the interface language", async () => {
	const render = () =>
		renderToStaticMarkup(
			<>
				<Command label="Search">
					<CommandList />
				</Command>
				<ToastProvider>
					<ToastViewport />
				</ToastProvider>
			</>,
		);
	expect(render()).toContain('aria-label="Suggestions"');
	expect(render()).toContain('aria-label="Notifications (F8)"');
	await applyLocale("de", {
		de: {
			"common.suggestions": "Vorschläge",
			"common.notificationsRegion": "Benachrichtigungen ({{hotkey}})",
		},
	});
	expect(render()).toContain('aria-label="Vorschläge"');
	expect(render()).toContain('aria-label="Benachrichtigungen (F8)"');
});

function LocalizedSearch() {
	const t = useT();
	return (
		<Command label={t("chat.modelPicker.searchWithLevel")}>
			<CommandInput />
			<CommandList />
		</Command>
	);
}

test("the command input's label follows the interface language", async () => {
	const render = () => renderToStaticMarkup(<LocalizedSearch />);
	expect(render()).toMatch(/<label[^>]*>Search models… \(append a level: opus high\)<\/label>/);
	await applyLocale("de", {
		de: { "chat.modelPicker.searchWithLevel": "Modelle suchen… (Level anhängen: opus high)" },
	});
	expect(render()).toMatch(/<label[^>]*>Modelle suchen… \(Level anhängen: opus high\)<\/label>/);
});
