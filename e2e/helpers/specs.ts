import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SeededSpec {
  /** Spec id from frontmatter — must match what tests assert against. */
  id: string;
  /** Path relative to the project root, e.g. "specs/example.md". */
  relPath: string;
  /** Full text written to disk (frontmatter + body). */
  content: string;
}

const DEFAULT_BODY = `# Example Spec\n\nThis is a seeded e2e fixture spec.\n`;

/**
 * Build a markdown spec string with valid YAML frontmatter.
 *
 * The defaults produce a managed `module-design` spec that the backend index
 * will pick up after the project is opened.
 */
export function buildSpec(opts: {
  id: string;
  type?: string;
  status?: string;
  title?: string;
  body?: string;
  parent?: string;
}): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${opts.id}`);
  lines.push(`type: ${opts.type ?? "module-design"}`);
  if (opts.status) lines.push(`status: ${opts.status}`);
  lines.push(`title: ${opts.title ?? "Example Spec"}`);
  if (opts.parent) lines.push(`parent: ${opts.parent}`);
  lines.push("---");
  lines.push("");
  lines.push(opts.body ?? DEFAULT_BODY);
  return lines.join("\n");
}

/**
 * Seed a temp-project directory with a `.tr/` marker plus one or more
 * spec files. The picker will recognise the directory as an existing project.
 *
 * The backend rebuilds its index when the project is opened, so any specs
 * written here will surface in the SpecTree.
 */
export function seedProject(
  projectPath: string,
  specs: { relPath: string; content: string }[],
): void {
  mkdirSync(join(projectPath, ".tr"), { recursive: true });
  for (const s of specs) {
    const full = join(projectPath, s.relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, s.content, "utf8");
  }
}
