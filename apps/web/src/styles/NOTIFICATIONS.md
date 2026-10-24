---
id: web-notices
type: submodule-design
status: active
title: ThinkRail in-app notices — one look for toasts and inline banners
parent: module-web
references: [web-color, web-spacing, web-typography]
---

# In-app notices

One visual language for every transient or inline message the app shows inside its own window: toasts
(`packages/ui/toast.tsx` composed by `panels/Toaster`) and inline notices such as `ProjectTrustNotice`,
`ProviderWarningBanner`, the trust notices in `SkillsDialog` / `NewWorkspaceDialog`, and the chat
`ErrorTurn` / `CompactionNotice`. OS-level notifications are a different thing, owned by the `notifications`
module.

## Raising a toast

Use the store helpers: `toast.info|success|warning|error(message, title?)` from `@/store`. Use `pushToast`
when you need an `action` (`{ label, onClick }`) or a custom `durationMs`. Error toasts stay until
dismissed. Every other toast auto-dismisses.

## Surface

- Neutral fill: `bg-container-elevated-bg` for every severity. No tinted `bg-feedback-*-subtle` fill and
  no left accent stripe.
- Severity is shown only by the 1px border (`border-feedback-<severity>-muted`) and the icon colour
  (`text-feedback-<severity>`). Body text stays `text-text-default`.
- Geometry: `rounded-sm`. Inline notices use `px-12 py-8`, or `px-8 py-4` inside dense side panels
  such as the Resources inspector. Toasts use `p-12`.
- Text: message `tr-text-ui text-text-default`, secondary line `tr-text-metadata text-text-muted`.

## Icons

Use one Line glyph per severity, everywhere, coloured with the matching `text-feedback-*` and marked
`aria-hidden`:

| Severity | Glyph |
|---|---|
| info | `RiInformationLine` |
| success | `RiCheckboxCircleLine` |
| warning | `RiAlertLine` (triangle) |
| error | `RiErrorWarningLine` (circled `!`) |

A notice whose meaning is more specific than its severity may use a domain glyph, for example
`RiShieldCheckLine` on the trusted-project notice.

## Layout

Pick one of two layouts based on the content:

- **Single line** (one short message, no secondary line): `flex items-center gap-8`. The icon, message
  (`flex-1`) and actions sit in one row. Nudge a 14px icon with `-mt-2` so it lines up optically with the
  text.
- **Multi-line** (a secondary line, or a message that can wrap): `flex flex-col gap-8`. Put the icon and
  text in a content row (`flex items-start gap-8`, icon `mt-2` to match the first line). Put the actions
  in a footer row (`flex justify-end gap-8`). Never keep actions on the right of text that wraps.

Toasts always use the multi-line layout. `ToastClose` sits in the content row, and the optional action
goes in a `mt-12` footer.

## Actions

- Use `size="sm"` buttons. The primary action is `variant="outline"`. A secondary action next to it is
  `variant="ghost"`.
- Never use a filled (`default`) or coloured button inside a notice. The border already carries the
  severity, and a filled button would compete with the page's primary action.
- A toast action is rendered through `ToastAction asChild` around a `Button`. That way Radix still closes
  the toast and announces the action's `altText`.

## Not yet migrated

A few older error surfaces still use the tinted style, for example `ExistingWorktreeDialog` and the
`SpecsPanel` load error. Migrate them when you next touch them, and do not copy their style into new
notices. Markdown alert callouts (`resource-renderers/support/markdownAlerts`) are not notices: they deliberately mirror
GitHub's alert styling.
