import { afterEach, expect, test } from "bun:test";
import { applyLocale } from "@thinkrail/locales/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Command, CommandList } from "./command";
import { ToastProvider, ToastViewport } from "./toast";

afterEach(() => applyLocale("en", {}));

test("library defaults for the suggestion list and toast region follow the interface language", () => {
	const render = () =>
		renderToStaticMarkup(
			<>
				<Command>
					<CommandList />
				</Command>
				<ToastProvider>
					<ToastViewport />
				</ToastProvider>
			</>,
		);
	expect(render()).toContain('aria-label="Suggestions"');
	expect(render()).toContain('aria-label="Notifications (F8)"');
	applyLocale("de", {
		de: {
			"common.suggestions": "Vorschläge",
			"common.notificationsRegion": "Benachrichtigungen ({{hotkey}})",
		},
	});
	expect(render()).toContain('aria-label="Vorschläge"');
	expect(render()).toContain('aria-label="Benachrichtigungen (F8)"');
});
