# design-audit — button-system catalog (preview tooling, not shipped)

Preview tooling for the shared button system in `packages/ui/button.tsx`
([[module-ui]] "Button system"). Nothing in `apps/`, `packages/` or `thinkrail-extensions/` imports it,
and production Tailwind never scans it.

| Path | What it is |
| --- | --- |
| `buttons.html` | **The button catalog in one self-contained file** — open it directly, no server or network needed. It renders the production `Button` / `IconButton` with the production stylesheet and a theme switcher, and includes: the 60-specimen matrix (5 variants × 3 sizes × 4 content configurations); labelled states per variant and size (default, hover, pressed, focus-visible, disabled, loading, and selected where it exists); a pressed-vs-selected section with the app's persistent selections and the real panel tool rails (mock entries); live buttons for real hover, press and keyboard focus; a live production toast for real `ToastClose` focus; measured size, padding, gap, icon and contrast under every specimen; and before/after crops of the exemplars (`data/buttons-before/`). |
| `buttons/` | Catalog sources. The chrome uses `bk-*` classes only and never targets specimen markup. |
| `catalog/pseudo.ts` | The forced-state fixture: every production rule with `:hover`, `:active` or `:focus-visible` is duplicated onto a marker class, so states render without a pointer. Specimens using it are labelled "forced". |
| `buttons-migration.md` | The migration record: old → new variant and size per call site, accent-text actions moved to `soft-primary`, size exceptions, and every remaining raw `<button>` with the reason it is not a shared button. |
| `tooling/` | `build-buttons.ts` builds the catalog (with `--serve` for a live preview); `verify-buttons.ts` loads it in all six themes and checks geometry, focus and label contrast → `data/verification/buttons/summary.json`. |

```sh
bun run build:web                                  # production apps/web/dist — the catalog uses its CSS verbatim
bun design-audit/tooling/build-buttons.ts [--serve] # buttons.html, or a live preview at http://localhost:24390/
bun design-audit/tooling/verify-buttons.ts         # all 6 themes (Node ≥ 22 on PATH for Playwright)
```
