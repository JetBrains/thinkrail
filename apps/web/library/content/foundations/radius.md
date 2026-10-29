Radius is the project t-shirt family: a small primitive geometry, so corners stay quiet and nested
surfaces never fight. The steps and their current values, from `tokens.css`:

:::live radius-scale

## Which step

- **`sm`** is the **default** corner for ordinary standalone controls — buttons, inputs, rows, tabs and
  tool cards.
- **`xs`** is the text-run tier: a corner on a tint that sits *behind* running text — a `<mark>` search
  hit, a composer slot placeholder, inline code, a keycap — where `sm` would read as a chip.
- **`md`** is the **outer** corner when a surface nests `sm` children and needs the extra step to read
  correctly — chosen by design, never a runtime "child + 2px".
- **`lg`** is reserved for large, visually independent elevated surfaces — dialogs, user-message
  bubbles, the AskUserQuestion outer card. It is the exception, never the default for a card.
- Nothing above `lg`. `rounded-full` (a pill or circle) is not on this scale.

## Rules

- **Ordinary radius comes from the scale, never a raw length** — `rounded-md`, not `rounded-[7px]`.
  `spacingUsage.test.ts` rejects an arbitrary radius value.
- **Radius tokens are Tailwind's radius namespace.** `tokens.css` declares `--radius-xs/sm/md/lg` in an
  `@theme static` block that first resets Tailwind's default scale (`--radius-*: initial`). So
  `rounded-<step>` and its side variants resolve to the live tokens, an undeclared step such as
  `rounded-xl` is never generated, and `static` keeps every variable emitted for hand-written CSS. Because the
  token names and Tailwind's radius names are the same, no call site spells a radius as an arbitrary
  value (`rounded-[var(--radius-md)]`).
- Components own their radius (the Button system uses `rounded-sm` at every size); a call site never
  changes it.
