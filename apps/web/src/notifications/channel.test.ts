import { describe, expect, test } from "bun:test";
import type { NativeNotificationBridge, NativeNotificationInput } from "@thinkrail/contracts";
import { createDesktopNotificationChannel } from "./desktopNotifications";
import type { NotificationSpec } from "./formatNotification";

function singleSpec(overrides: Partial<NotificationSpec> = {}): NotificationSpec {
	return {
		title: "ThinkRail",
		subtitle: "feature-branch",
		body: "Waiting for your input",
		tag: "attention:s1",
		target: { kind: "chat", workspaceId: "w1", sessionId: "s1" },
		...overrides,
	};
}

describe("desktop notification channel", () => {
	function harness() {
		const shown: NativeNotificationInput[] = [];
		const bridge: NativeNotificationBridge = { show: (input) => shown.push(input) };
		return { shown, channel: createDesktopNotificationChannel(bridge) };
	}

	test("permission is always granted (OS-managed, no browser flow)", async () => {
		const { channel } = harness();
		expect(channel.permission()).toBe("granted");
		await expect(channel.requestPermission()).resolves.toBe("granted");
	});

	test("maps the spec to the native bridge, keeping subtitle distinct from body", () => {
		const { shown, channel } = harness();
		channel.show(singleSpec(), () => {});
		expect(shown).toEqual([
			{
				title: "ThinkRail",
				subtitle: "feature-branch",
				body: "Waiting for your input",
				silent: false,
			},
		]);
	});

	test("omits subtitle when the spec has none (aggregate)", () => {
		const { shown, channel } = harness();
		channel.show(
			singleSpec({
				subtitle: undefined,
				body: "2 worktrees need your attention",
				target: { kind: "app" },
			}),
			() => {},
		);
		expect(shown[0]).toEqual({
			title: "ThinkRail",
			body: "2 worktrees need your attention",
			silent: false,
		});
	});
});
