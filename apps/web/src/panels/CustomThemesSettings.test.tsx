import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomThemesGroup } from "./CustomThemesSettings";

test("shows the theme folder row with the steps, its two actions, and one notice per broken file", () => {
	const markup = renderToStaticMarkup(
		<CustomThemesGroup
			snapshot={{ dir: "/home/me/.thinkrail/themes", files: [] }}
			issues={[{ fileName: "copy.theme.json", error: "duplicate-id", detail: "ocean" }]}
			appVersion="1.2.3"
			onCopyFolder={() => {}}
			onRevealFolder={() => {}}
		/>,
	);
	expect(markup).toContain('data-setting-id="theme-folder"');
	expect(markup).toContain("Theme files folder");
	expect(markup).toContain("/home/me/.thinkrail/themes");
	expect(markup).toContain("/blob/v1.2.3/apps/web/src/themes/bundled/dark.theme.json");
	expect(markup).toMatch(/<a[^>]*data-testid="custom-themes-example"[^>]*tabindex="0"/);
	expect(markup).toMatch(/<button[^>]*tabindex="0"[^>]*>.*Copy path/);
	expect(markup).toMatch(/<button[^>]*tabindex="0"[^>]*data-testid="custom-themes-open-folder"/);
	expect(markup).toContain('data-testid="custom-theme-issue-copy.theme.json"');
	expect(markup).toContain("Another theme file already uses this id");
});

test("renders nothing when the host cannot serve theme files", () => {
	expect(
		renderToStaticMarkup(
			<CustomThemesGroup
				snapshot={null}
				issues={[]}
				appVersion={null}
				onCopyFolder={() => {}}
				onRevealFolder={() => {}}
			/>,
		),
	).toBe("");
});
