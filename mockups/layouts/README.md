# Layout mockups

Full-screen HTML concepts for the ThinkRail layout redesign. **Open `index.html` for the gallery**
(live scaled previews; click a card for the full mockup), or open any `NN-*.html` directly.

- `00-current-baseline.html` — today's layout with the six reported problems pinned (red markers).
- `01…11-*.html` — redesign concepts; green markers show where each problem is solved. Every page
  has a "Hide notes" toggle.
- `RESEARCH.md` — synthesis of the competitor / UX-trend / IDE-convention research behind the set.
- `kit.css` — shared design kit mirroring `apps/web/src/styles/tokens.css` (mockups wear the real
  product theme; not part of the app bundle).

The six problems, numbered consistently everywhere:
1. dead top-bar space · 2. no side-by-side chats · 3. oversized rarely-used projects panel ·
4. terminal too small · 5. files/specs expected on the left · 6. tabs not draggable between areas.

Convention: mockups are immutable once discussed — layout changes requested in review land as NEW
numbered files (12-, 13-, …) so the trail of decisions stays browsable.
