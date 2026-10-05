import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	isWindowFocused,
	notificationPermission,
	notificationsSupported,
	requestNotificationPermission,
	showBrowserNotification,
} from "./webNotifications";

type MockPermission = "default" | "granted" | "denied";

class MockNotification {
	static permission: MockPermission = "granted";
	static requestPermission = mock(async () => MockNotification.permission);
	static instances: MockNotification[] = [];
	static throwOnConstruct = false;
	onclick: ((event: { preventDefault: () => void }) => void) | null = null;
	closed = false;
	constructor(
		public title: string,
		public options: { body: string; tag: string; icon?: string },
	) {
		if (MockNotification.throwOnConstruct) throw new TypeError("unsupported");
		MockNotification.instances.push(this);
	}
	close() {
		this.closed = true;
	}
}

const saved = {
	window: (globalThis as Record<string, unknown>).window,
	document: (globalThis as Record<string, unknown>).document,
	Notification: (globalThis as Record<string, unknown>).Notification,
};

let focusCalls: number;

beforeEach(() => {
	MockNotification.permission = "granted";
	MockNotification.instances = [];
	MockNotification.throwOnConstruct = false;
	MockNotification.requestPermission = mock(async () => MockNotification.permission);
	focusCalls = 0;
	(globalThis as Record<string, unknown>).Notification = MockNotification;
	(globalThis as Record<string, unknown>).window = globalThis;
	(globalThis as { focus?: () => void }).focus = () => {
		focusCalls++;
	};
	(globalThis as Record<string, unknown>).document = { hasFocus: () => true };
});

afterEach(() => {
	(globalThis as Record<string, unknown>).window = saved.window;
	(globalThis as Record<string, unknown>).document = saved.document;
	(globalThis as Record<string, unknown>).Notification = saved.Notification;
});

describe("support + permission reads", () => {
	test("supported when window carries Notification", () => {
		expect(notificationsSupported()).toBe(true);
		expect(notificationPermission()).toBe("granted");
	});

	test("reports the live permission value", () => {
		MockNotification.permission = "denied";
		expect(notificationPermission()).toBe("denied");
	});

	test("unsupported when Notification is absent", () => {
		(globalThis as Record<string, unknown>).window = {};
		expect(notificationsSupported()).toBe(false);
		expect(notificationPermission()).toBe("unsupported");
	});
});

describe("requestNotificationPermission", () => {
	test("delegates to the API", async () => {
		MockNotification.permission = "granted";
		await expect(requestNotificationPermission()).resolves.toBe("granted");
		expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
	});

	test("returns unsupported without the API, never calling it", async () => {
		(globalThis as Record<string, unknown>).window = {};
		await expect(requestNotificationPermission()).resolves.toBe("unsupported");
	});

	test("maps a thrown request to denied", async () => {
		MockNotification.requestPermission = mock(async () => {
			throw new Error("blocked");
		});
		await expect(requestNotificationPermission()).resolves.toBe("denied");
	});
});

describe("isWindowFocused", () => {
	test("reflects document.hasFocus", () => {
		(globalThis as Record<string, unknown>).document = { hasFocus: () => false };
		expect(isWindowFocused()).toBe(false);
		(globalThis as Record<string, unknown>).document = { hasFocus: () => true };
		expect(isWindowFocused()).toBe(true);
	});
});

describe("showBrowserNotification", () => {
	const input = {
		title: "branch",
		body: "Waiting for your input",
		tag: "attention:s1",
		onClick: () => {},
	};

	test("no-op unless permission is granted", () => {
		MockNotification.permission = "default";
		showBrowserNotification(input);
		expect(MockNotification.instances).toHaveLength(0);
	});

	test("constructs with title/body/tag when granted", () => {
		showBrowserNotification(input);
		expect(MockNotification.instances).toHaveLength(1);
		expect(MockNotification.instances[0]?.title).toBe("branch");
		expect(MockNotification.instances[0]?.options).toEqual({
			body: "Waiting for your input",
			tag: "attention:s1",
			icon: "/favicon.svg",
		});
	});

	test("click focuses the window, runs onClick, and closes", () => {
		let clicked = 0;
		showBrowserNotification({ ...input, onClick: () => clicked++ });
		const notification = MockNotification.instances[0];
		let defaultPrevented = false;
		notification?.onclick?.({ preventDefault: () => (defaultPrevented = true) });
		expect(defaultPrevented).toBe(true);
		expect(focusCalls).toBe(1);
		expect(clicked).toBe(1);
		expect(notification?.closed).toBe(true);
	});

	test("a throwing constructor (mobile) is swallowed, not propagated", () => {
		MockNotification.throwOnConstruct = true;
		expect(() => showBrowserNotification(input)).not.toThrow();
	});
});
