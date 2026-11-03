import { expect, test } from "bun:test";
import {
	formatSubscriptionUsd,
	subscriptionWindowAmount,
	subscriptionWindowKey,
	usageTone,
} from "./SubscriptionLimits";

test("names hour and day windows, and leaves anything else to the percentage", () => {
	expect(subscriptionWindowKey(18_000)).toBe("panels.subscriptionLimits.windowHours");
	expect(subscriptionWindowKey(604_800)).toBe("panels.subscriptionLimits.windowDays");
	expect(subscriptionWindowKey(null)).toBeNull();
	expect(subscriptionWindowKey(90)).toBeNull();
});

test("divides a window by the unit its label names", () => {
	expect(subscriptionWindowAmount(18_000)).toBe(5);
	expect(subscriptionWindowAmount(604_800)).toBe(7);
});

test("recolours the bar before the provider refuses the request", () => {
	expect(usageTone(0)).toBe("calm");
	expect(usageTone(69)).toBe("calm");
	expect(usageTone(70)).toBe("warm");
	expect(usageTone(90)).toBe("hot");
});

test("formats money the way the reader's locale expects", () => {
	expect(formatSubscriptionUsd(12.4, "en-US")).toBe("$12.40");
	expect(formatSubscriptionUsd(0, "en-US")).toBe("$0.00");
});
