import { readdirSync } from "node:fs";

export const LINUX_DESKTOP_CATEGORIES = "Development;IDE;";

export interface LinuxNotification {
	title: string;
	body: string;
	subtitle?: string | undefined;
	silent?: boolean | undefined;
}

export function linuxNotificationCommand(
	notification: LinuxNotification,
	identity: { iconPath: string; desktopEntry: string | null },
): string[] {
	const body = [notification.subtitle, notification.body].filter(Boolean).join("\n");
	return [
		"notify-send",
		"--app-name=ThinkRail",
		`--icon=${identity.iconPath}`,
		...(identity.desktopEntry ? [`--hint=string:desktop-entry:${identity.desktopEntry}`] : []),
		...(notification.silent ? ["--urgency=low"] : []),
		"--",
		notification.title,
		...(body ? [body] : []),
	];
}

export function desktopEntryId(appDir: string): string | null {
	const entry = readdirSync(appDir).find((name) => name.endsWith(".desktop"));
	return entry ? entry.slice(0, -".desktop".length) : null;
}

export function withDesktopCategories(entry: string, categories: string): string {
	const lines = entry.split("\n");
	const index = lines.findIndex((line) => line.startsWith("Categories="));
	if (index === -1) {
		const header = lines.indexOf("[Desktop Entry]");
		lines.splice(header + 1, 0, `Categories=${categories}`);
	} else {
		lines[index] = `Categories=${categories}`;
	}
	return lines.join("\n");
}
