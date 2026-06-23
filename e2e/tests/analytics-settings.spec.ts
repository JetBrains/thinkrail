import { test, expect, type Page } from "../fixtures";
import { openProject } from "../helpers/project";
import { header } from "../helpers/selectors";
import { getAnalyticsConsent, setAnalyticsConsent } from "../helpers/appSettings";

/**
 * Settings → Privacy: the in-app analytics toggle is bound to the same
 * AppStore consent record as the install flag and the CLI. Toggling applies
 * immediately (opt-in/opt-out), the choice survives a reload, and only
 * `enabled` ever crosses the wire — the per-install id stays backend-side.
 *
 * AppStore is shared across every project and test run, so each test seeds a
 * known starting state first.
 */

const MODAL = ".settings-modal";
const NAV = `${MODAL} nav[aria-label='Settings sections']`;

async function gotoPrivacy(page: Page) {
  await page.locator(header.settingsButton).click();
  await expect(page.locator(MODAL)).toBeVisible({ timeout: 15_000 });
  await page.locator(`${NAV} button`, { hasText: "Privacy" }).click();
  await expect(page.locator(`${MODAL} h3.settings-section__title`)).toHaveText("Privacy");
  return page.getByRole("checkbox", { name: "Send anonymous usage analytics" });
}

test("Privacy toggle reflects consent and writes it through both ways (no id on the wire)", async ({
  page,
  tempProject,
}) => {
  const seeded = await setAnalyticsConsent(tempProject.path, true);
  // The wire payload carries only `enabled` — never the installation id.
  expect(seeded).toEqual({ enabled: true });

  await openProject(page, tempProject.path);

  // Settings exposes a Privacy section alongside the other tabs.
  await page.locator(header.settingsButton).click();
  await expect(page.locator(MODAL)).toBeVisible({ timeout: 15_000 });
  for (const label of ["Session Defaults", "Privacy", "Server Info", "Settings"]) {
    await expect(page.locator(`${NAV} button`, { hasText: label })).toBeVisible();
  }
  await page.locator(`${NAV} button`, { hasText: "Privacy" }).click();
  await expect(page.locator(`${MODAL} h3.settings-section__title`)).toHaveText("Privacy");

  const toggle = page.getByRole("checkbox", { name: "Send anonymous usage analytics" });
  await expect(toggle).toBeChecked();

  // Opt out → the AppStore record flips to disabled.
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(() => getAnalyticsConsent(tempProject.path), { timeout: 15_000 })
    .toEqual({ enabled: false });

  // Opt back in → enabled again.
  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect
    .poll(() => getAnalyticsConsent(tempProject.path), { timeout: 15_000 })
    .toEqual({ enabled: true });
});

test("Privacy opt-out persists across a reload", async ({ page, tempProject }) => {
  await setAnalyticsConsent(tempProject.path, true);

  await openProject(page, tempProject.path);

  const toggle = await gotoPrivacy(page);
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect
    .poll(() => getAnalyticsConsent(tempProject.path), { timeout: 15_000 })
    .toEqual({ enabled: false });

  await page.reload();
  await expect(page.locator(header.settingsButton)).toBeVisible({ timeout: 60_000 });

  const toggleAfter = await gotoPrivacy(page);
  await expect(toggleAfter).not.toBeChecked();
});
