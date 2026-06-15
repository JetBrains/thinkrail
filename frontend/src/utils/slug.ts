/** Turn a project name into a filesystem-safe folder name.
 *  "Inventory Service" → "inventory-service". */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
