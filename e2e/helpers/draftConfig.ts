import { expect, type Page } from "@playwright/test";

/**
 * DraftConfigCard's model / perms / effort pickers are custom `<Dropdown>`s
 * (`.dd-trigger` button → `.dd-menu[role=listbox]` of `.dd-item[role=option]`),
 * scoped by their `model:` / `perms:` / `effort:` hint. The trigger shows the
 * active option's label; for perms/effort the SDK value doubles as the label.
 */
export type DropdownKind = "model" | "perms" | "effort";

function triggerSelector(kind: DropdownKind): string {
  return `.draft-config-inline:has(.draft-config-hint:text-is("${kind}:")) .dd-trigger`;
}

/** The active option's visible label (the closed trigger's text). */
export function selectedLabel(page: Page, kind: DropdownKind) {
  return page.locator(`${triggerSelector(kind)} .dd-trigger-label`);
}

/** Open the dropdown, returning a locator for its option rows. */
async function openMenu(page: Page, kind: DropdownKind) {
  const trigger = page.locator(triggerSelector(kind));
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  return page.locator(".dd-menu[role=listbox] .dd-item");
}

/** Ordered option labels for a dropdown (opens then closes it). */
export async function optionLabels(page: Page, kind: DropdownKind): Promise<string[]> {
  const items = await openMenu(page, kind);
  await expect(items.first()).toBeVisible({ timeout: 15_000 });
  const labels = (await items.allInnerTexts()).map((t) => t.trim());
  await page.keyboard.press("Escape");
  return labels;
}

/** Pick an option by its visible label. */
export async function pickOption(page: Page, kind: DropdownKind, label: string): Promise<void> {
  await openMenu(page, kind);
  await page.locator(".dd-menu[role=listbox] .dd-item", { hasText: label }).first().click();
}
