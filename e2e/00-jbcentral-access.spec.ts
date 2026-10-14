import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";
import {
	assertOnlyReviewedArgv,
	centralInvocationCount,
	connectCentral,
	openProviders,
	waitForCentralState,
} from "./fixtures/jbcentral";
import { E2E_CENTRAL_STATE } from "./fixtures/paths";

const sources = (page: import("@playwright/test").Page) =>
	page.getByTestId("jbcentral-access-sources");
const rows = (page: import("@playwright/test").Page) =>
	page.getByTestId("jbcentral-access-source-row");

test("@dev-seam switching the AI access source restarts the proxy and re-lists the current source", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");

	await expect(sources(page)).toBeVisible();
	await expect(
		sources(page).getByText(
			"Switching affects all apps that use central under this OS user account on the host.",
		),
	).toBeVisible();
	await expect(rows(page)).toHaveCount(2);
	const alumniRow = rows(page).filter({ hasText: "JB Alumni" });
	const teamRow = rows(page).filter({ hasText: "JetBrains Team" });
	await expect(teamRow).toHaveAttribute("data-current", "true");
	await expect(alumniRow).toHaveAttribute("data-current", "false");

	await alumniRow.getByRole("button", { name: "Switch to this source", exact: true }).click();
	await expect(alumniRow).toHaveAttribute("data-current", "true", { timeout: 10_000 });
	await expect(teamRow).toHaveAttribute("data-current", "false");
	await expect(page.getByTestId("jbcentral-access-restart-warning")).toHaveCount(0);

	expect(centralInvocationCount("login export")).toBeGreaterThan(0);
	expect(centralInvocationCount("access workspace:aaa:bbb")).toBeGreaterThan(0);
	expect(centralInvocationCount("proxy stop")).toBeGreaterThan(0);
	assertOnlyReviewedArgv();
});

test("@dev-seam a failed switch surfaces an error and never restarts the proxy", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");
	writeFileSync(E2E_CENTRAL_STATE, "access-switch-error");

	await rows(page)
		.filter({ hasText: "JB Alumni" })
		.getByRole("button", { name: "Switch to this source", exact: true })
		.click();
	await expect(page.getByTestId("jbcentral-access-error")).toBeVisible();
	expect(centralInvocationCount("proxy stop")).toBe(0);
});
