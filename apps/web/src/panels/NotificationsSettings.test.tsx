import { expect, test } from "bun:test";
import { EN } from "@thinkrail/locales";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationPermissionNotice } from "./NotificationsSettings";

const notice = (permission: Parameters<typeof NotificationPermissionNotice>[0]["permission"]) =>
	renderToStaticMarkup(<NotificationPermissionNotice permission={permission} onAllow={() => {}} />);

const text = (key: keyof typeof EN) =>
	String(EN[key]).replaceAll("'", "&#x27;").replaceAll('"', "&quot;");

test("blocked notifications show How to enable and every step as visible text, not a disclosure", () => {
	const markup = notice("denied");
	expect(markup).toContain('data-testid="notifications-permission-warning"');
	expect(markup).toContain(text("settings.notifications.blocked"));
	expect(markup).toContain(text("settings.notifications.howToEnable"));
	for (const step of ["lock", "find", "allow", "refresh"] as const) {
		expect(markup).toContain(text(`settings.notifications.step.${step}`));
	}
	expect(markup).not.toContain("aria-expanded");
	expect(markup).not.toContain("<button");
});

test("a permission not yet asked offers Allow as a walk row with an explicit tab stop", () => {
	const markup = notice("default");
	expect(markup).toContain('data-setting-row="notifications-permission"');
	expect(markup).toMatch(/<button[^>]*tabindex="0"[^>]*data-testid="notifications-allow"/);
	expect(markup).not.toContain(text("settings.notifications.howToEnable"));
});

test("an unsupported browser says so, and a granted permission shows no notice", () => {
	expect(notice("unsupported")).toContain(text("settings.notifications.unsupported"));
	expect(notice("unsupported")).not.toContain(text("settings.notifications.howToEnable"));
	expect(notice("granted")).toBe("");
});
