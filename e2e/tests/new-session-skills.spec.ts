import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { newSession } from "../helpers/selectors";

/**
 * Verify the SkillGrid in the new-session draft renders every skill the
 * project ships in `claude-plugin/skills/`. Locks in the contract that
 * `skills/list` exposes the full plugin set and the picker wires it up.
 *
 * Regression guard: a missing `SKILL.md`, a backend scan that drops a
 * directory, or a frontend filter that hides a group would all surface
 * here as a missing card.
 */

const SKILLS_DIR = resolve(__dirname, "..", "..", "claude-plugin", "skills");

function expectedSkillIds(): string[] {
  return readdirSync(SKILLS_DIR)
    .filter((name) => {
      try {
        return statSync(resolve(SKILLS_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

test("new-session skill picker renders every plugin skill", async ({
  page,
  tempProject,
}) => {
  const expected = expectedSkillIds();
  expect(
    expected.length,
    "expected at least one skill directory under claude-plugin/skills/",
  ).toBeGreaterThan(0);

  await openProject(page, tempProject.path);

  await page.locator(newSession.newButton).click();
  await page.locator(newSession.skillSelectButton).click();

  const grid = page.locator(newSession.skillGrid);
  await expect(grid).toBeVisible();

  // Skill cards display the frontmatter `name` (== directory name in this
  // project) inside `.skill-card-name`. Read them all once and compare to
  // the on-disk set.
  const rendered = await grid
    .locator(newSession.skillCardName)
    .allInnerTexts();
  const renderedSorted = rendered.map((s) => s.trim()).sort();

  expect(renderedSorted).toEqual(expected);

  // bonsai-brainstorm is the canary we explicitly want visible — surface a
  // clear failure if the plugin scan ever drops it.
  expect(renderedSorted).toContain("bonsai-brainstorm");
});
