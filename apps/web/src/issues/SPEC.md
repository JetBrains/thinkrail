---
id: submodule-web-issues
type: submodule-design
status: active
title: issues — project issue summaries and connection
parent: module-web
depends-on: [module-contracts, module-locales, module-ui]
---

## Responsibility

Arrangement-agnostic repository connection form and compact kanban summary tool for the right workbench
rail, covering GitLab and GitHub repositories with identical issue and label presentation. `index.ts` is the public surface, and exports exactly: `IssuesTool`; `IssuesPanel` and `IssuesPanelProps`; `supportsIssues`; `supportsIssueAuth`; the skippable `IssueAssociationDialog` and `IssueAssociationDialogProps` used after a project opens; `ProjectOpenGesture`; the dual-entry rule `shouldPromptAssociation`; and the `notifyIssueAssociation` signal a successful post-open connect raises. `IssueAssociationForm.tsx` is internal: the one address/instance/consent/token form both the panel and the dialog render, so a second token path cannot drift into existence.

## Boundary

Depends on contracts (credential-free summary/connection DTOs, the `IssueSessionLaunch` DTO with
`isIssueSessionLaunch`, the read, auth, action, approval, design-approval, implementation and localized-startup protocol
floors, `canonicalIssueInstanceUrl`, `requiresIssueHttpConsent`, `isIssueConnectionInput`), locales, UI
controls
(including the shared dialog primitive), React, the transport barrel, store selectors for connection
capability/lifetime only, and QuietScrollArea. It dispatches host-side actions but creates no session and
no workspace: navigation is the shell's job through the one launch callback.
Never imports server code or the layout engine. Shell injects project identity; no provider credentials
enter the app store or browser persistence. Token state is component-local to the form, cleared
synchronously before
submitting even on rejection, and the panel remounts with project/connection identity. The host owns the
credential: where `supportsIssueAuth` holds it writes the token to the operating system credential vault
and restores it after a restart, so the form says exactly that and never calls the token session-only. A
missing or locked vault shows a reconnect step instead of pretending the association is live. A v103/v104
host cannot write that vault, so it gets no vault-persistence hint and no reconnect invitation.

## Behavior

Host protocol v103 gates the read/connection RPCs (`issues.connection`, `issues.list`,
`issues.disconnect`); `issues.connect` — the only token-bearing call — is gated at the v105 Issues auth
protocol and `supportsIssueAuth` is that floor. On a v103/v104 host the panel still reads and displays
existing connection metadata, but the connect/reconnect form is disabled and labelled as needing a newer
host, so no submission is dispatched from a form that cannot create a durable association and none is
reported as successful. That metadata-only view also omits the credential-vault guarantee and the
reconnect invitation; `issues.authUnsupported` is the only copy it adds. Offline/unsupported hosts render explanatory copy without requesting. Read
connection, then list only when connected; connect refreshes the list. Refresh is explicit; no polling or
stage mutations.

**Dual entry.** A project can be associated from the Issues tool (the panel form) or from the prompt the
The provider is derived, never chosen in the UI: `resolveIssueRepositoryAddress` keeps requiring an
explicit instance for every host except `github.com` and `gitlab.com`, and `associationFormState`
marks a GitHub target with `issues.githubUnsupported` — clearing `input` and blocking submit — when the
host protocol is below 110. Issue rows, labels and stage grouping do not branch on provider.

panels module opens right after a project is adopted. Both render `IssueAssociationForm.tsx`, so address,
instance/consent, prefill, token clearing and submit behavior exist once. `IssueAssociationDialog` is
that prompt: `{ projectId, initialRepositoryUrl?, onClose, onAssociated? }`. Its only dismissal is
Cancel/close (`issues.associateSkip`), which associates nothing, retries nothing, and changes no project
state; a successful connect calls `onAssociated(connection)` and then `onClose()`, and the panels caller
raises `notifyIssueAssociation(projectId)` from it so an already-mounted tool replaces the snapshot it
read before the association instead of keeping a stale one — no credential or connection state is
mirrored into the app store to achieve that. While a connect is pending the prompt is not dismissable at
all: the close control is hidden and `associationDismissal` answers `onOpenChange(false)`,
`onEscapeKeyDown` and `onInteractOutside` by ignoring or preventing them, while Skip stays present and
disabled. The dialog reads no
connection and fetches no hint of its own: the shell (panels) asks the host through
`issues.repositoryAddress` and passes the answer as `initialRepositoryUrl`, which only seeds the address
field. An unusable or absent hint (`null`) simply starts the form empty — the resolver still owns every
instance/project decision. The prompt only opens where `supportsIssueAuth` holds, and the form reports
its single connect error through `onError` as the `ISSUE_ERROR_KEY.connect` key. `shouldPromptAssociation`
encodes the trigger: opening, initializing or cloning an existing repository prompts; a project created
in this app does not, because it has no remote to associate yet.

The form takes one HTTP/HTTPS repository address and derives the association from it with
`resolveIssueConnectionAddress` (`repositoryAddress.ts`). The address may arrive prefilled from the
host-read `origin` hint (`issues.repositoryAddress`, v105); a prefill is never an association, never
grants HTTP consent, and never skips the confirmation described below. The standard gitlab.com root
selects its
instance without further input. A custom origin, or a path whose installation prefix is ambiguous,
returns `needs-instance`: the advanced disclosure opens prefilled with the address's own origin and the
project path derived from it, and the user confirms or corrects the instance so the split is explicit.
That forced opening hides the disclosure's own toggle (`associationFormState.advancedToggle`): a control
that cannot change the state it names is dead, so the toggle renders only where `advancedOpen` is the
only thing deciding the disclosure. The project path beside it is derived and read-only, because typing
a path the pasted address does not
describe would send coordinates nothing can corroborate; a wrong confirmation therefore fails at connect
and is reported as a connect failure, never as success. SSH/SCP addresses are classified before any
resolution and answered with HTTPS guidance; file and other schemes are refused as unsupported. Nothing
is probed, discovered, guessed or persisted while the form is being edited, and the Git remote is never
modified.

Non-local HTTP needs an explicit acknowledgment of the clear-text risk before a token is sent.
`requiresIssueHttpConsent` decides (HTTPS and literal loopback HTTP are exempt); the acknowledgment is
remembered as the canonical instance it was made for, so editing the address or the instance drops it and
the risk text, checkbox, and `httpConsent` field all name that exact canonical destination (scheme, host,
port and base path). `issueConnectionInput` refuses to build an input when consent is required but not
acknowledged, and it omits `httpConsent` entirely on HTTPS targets.

Reconnect reuses an existing connection: instance and remote project id are shown read-only and only a
new token is typed, because a clone URL cannot be derived backwards from a stored association. The token
field is never prefilled and is emptied before the request leaves the panel. A destination that still
requires clear-text acknowledgment asks for it again, since host-owned stored consent is not readable
here. The connect path reports its own success or failure to the panel: a successful reconnect closes the
form and returns to the connected view, while a failed one stays open under the keyed connect error and
the tool keeps the summaries it was reconnecting to, since its identity did not change and a failed
credential refresh cannot retract what a previous read already answered; the
list read that follows a successful connect keeps its separate list error. Cancelling that form abandons
the attempt altogether, so neither the panel's action error nor the snapshot-level connect error outlives
it — a connected view never keeps "could not connect" with no form to retry in. Disconnect is awaited;
failure keeps the metadata as last read, shows the disconnect error key and reports nothing removed.
Connect, disconnect, refresh, and open-issue failures render as i18n keys only (`ISSUE_ERROR_KEY`), never
raw transport text.

Connect and list failures stay distinct: a connect that succeeded and a list that then failed keeps the
live association and reports only the list failure, because a later read cannot deny the association it
follows. Local request sequencing and effect cleanup reject late replies after project, connection or
request changes; `loadIssueSnapshot` also stops between its own awaits once it is stale.

Summaries group all four stages — backlog, in-progress, in-review and closed — show labels verbatim
(including blocked labels), and open http(s)-only external title links with noopener/noreferrer. The read DTO carries no separate blocked
reason, so none is invented.

An optional generic `onOpenIssue(reference)` callback delegates navigation/session/workspace creation
entirely to the host. Without it, no open control renders.

**Stage actions.** Each issue offers exactly two actions — run design and run implementation — computed by
the pure `issueActions(issue, capabilities)`. Accepting either stage stays in GitLab, and so does closing an
issue: this panel records no approval and renders no accept/close control. The two stages interleave: neither
control is gated on the other's stage, and an issue at any open stage can start implementation because the
host moves a backlog issue forward on approval. A stage the issue already reached (`in-progress`/`in-review`
for design, `in-review` for implementation) renders its icon in the accent colour as completed. Closed issues
offer none at all. Each control carries its own host floor: design needs the v104 launch surface
(`supportsIssueActions`) and implementation needs the v108 start gate
(`supportsIssueImplementation`), and a missing floor leaves that control visible and disabled with
`needs-newer-host` instead of hiding it. MR creation and merge are not implemented in the
product and therefore appear nowhere: no control, menu entry, label or disabled placeholder is invented for
them. The two controls sit **on the issue title row, right-aligned**, as icon-only `IconButton`s (quill = run
design, code box = run implementation) inside their own `TooltipProvider`; each keeps its action name as
`aria-label`, a blocked one names its reason in the same tooltip plus `data-reason`, and a completed one is
rendered with the shared `soft-primary` button variant and `data-done`. A pending action disables every control. Dispatch goes through the one
`onRunAction(issue, action)` prop, whose keyed result the tool turns into the `actionPending`/`actionError`
props the panel renders.

Stage actions also need an explicitly trusted project: the host refuses every launch otherwise, and a plain
repository has no other trust affordance, so an untrusted project disables both controls with `needs-trust`
and the panel offers a one-click "Trust project" (`project.setTrust` via the shell, then a store update and
refresh). `needs-trust` yields to `needs-newer-host` when the host is also too old.

At v109 (`ISSUES_SESSION_STARTUP_PROTOCOL_VERSION`), design calls `issues.beginDesign` and
implementation calls `issues.beginImplementation`, each with exactly `{projectId, reference, locale}`.
The locale is the current `useT()` translator's resolved language, normalized canonically against
available bundled/local locales, never the saved `system` preference or a host locale fallback.
The host owns starting the stage agent; the tool never sends a prompt or configures a provider.
Older hosts retain `issues.launchDesign` (v104) / `issues.startImplementation` (v108), with no locale
field and no automatic agent startup; their tooltips explain that they open a chat instead of claiming
a run. Missing original floors still disable the existing buttons. No confirmation, approval read,
version minting or label mutation occurs. Design and implementation can be revisited in either order.

The host still exposes v106 `issues.approveDesign` / `issues.approveImplementation` and the v107
`issues.designApproval` read; this panel deliberately dispatches none of them. Related host-side actions
this panel does not consume are `issues.launchImplementation`, `issues.publishDesign`,
`issues.publishImplementation`, `issues.validateDesign` and `issues.validateImplementation`. The summary
read carries no approval state — `IssueSummary` has no receipt and no design version — and the panel no
longer reads, mints or forwards a design digest: no click-time `designApproval` call, no
`approvedDesignVersion` field. `IssueActionCall` holds exactly `launchDesign` and
`startImplementation` as UI aliases, routing to the v109 begin methods or legacy session methods by host version. A host denial, a transport failure or a malformed `IssueSessionLaunch` becomes the
keyed `issues.error.action`; `issues.error.unsupported` remains the catalog's keyed refusal for a host
below a control's floor, while the control itself stays disabled with `needs-newer-host`. Credentials and
transport text are never echoed in UI errors and the token never leaves the form. A successful launch is forwarded once to the optional
`onLaunchSession({ workspaceId, sessionId })`; the tool creates no session and sends no prompt, and re-reads
the summaries after a start; starting does not move stage labels. Without `onLaunchSession` the launch
still happens and navigates nowhere. The shell answers that callback by refreshing `workspace.list` for the
project, activating the returned workspace and opening its chat tab — again without creating or prompting a
session.

The shell registers the right-rail tool through the issues barrel; Balanced, Focus and Review include it
beside reference tools. The contracts LayoutToolId must include `issues` before these registrations
typecheck; the contracts owner owns host custom-preset validation and version compatibility.

## Repository address resolution

`repositoryAddress.ts` is a pure helper reached through the panel; it is not barrel-exported.
`resolveIssueRepositoryAddress(repositoryUrl, explicitInstanceUrl?)` returns a
`status`-discriminated `valid` result with canonical `instanceUrl` and decoded
namespace/project `projectId`, or `invalid` / `needs-instance` without echoing input.
Only HTTP/HTTPS repository addresses are supported; SSH/SCP and file addresses are rejected.
The shared public `canonicalIssueInstanceUrl` contract owns instance canonicalization.

Only the exact standard `https://gitlab.com` origin is known to be a root installation.
Every custom origin, including HTTP, loopback and nonstandard ports, needs an explicitly
user-confirmed instance URL before it can produce a valid association. This is not a host
allowlist: any valid same-origin instance can be supplied. The helper never guesses whether
leading path segments are an installation prefix or namespace. Advanced instance/project
fields remain the recommended confirmation fallback; a root-origin suggestion is not consent.
An explicit instance must match scheme, host, port and complete case-sensitive path segments;
the remaining path must contain at least namespace and repository. Root confirmation retains
all nested groups; subpath confirmation removes only the confirmed installation prefix.

`suggestIssueRepositoryAddress` returns that same origin and full path as prefill text for the
advanced fields. It is presentation only: it never marks an association confirmed, grants
HTTP consent, or reaches the wire on its own.

The host reads the project's read-only `origin` hint (local config fetch URL only) and answers it only
when there is exactly one remote and that remote is named `origin`. Several remotes, or a sole remote with
another name, are ambiguous and answer `null` rather than guessing which one to associate. The answer is
an already credential-free canonical HTTP(S) address; a `.git`-suffixed URL is parsed like any other
address, and the host's `null` means an empty first field rather than a guess. This module never asks for
a path, never inspects git, and never widens the host's answer.

Terminal slashes on repository and instance URLs are ignored; internal empty segments are
rejected. Only the terminal lowercase `.git` suffix is removed, never namespace suffixes.
Raw and decoded path segments reject dot/traversal, encoded separators, repeated encoding,
whitespace, controls, backslashes, query/fragment delimiters and userinfo. Validation happens
before URL parsing can normalize away traversal. Ordinary percent-encoded segment characters
are decoded once. This helper accepts no PAT and does no network access, discovery, persistence
or remote mutation. HTTP resolution does not grant HTTP consent: contracts/service/UI remain
responsible for credential transport risk and destination-scoped confirmation.

## Verification

`repositoryAddress.test.ts` pins known-root resolution, custom-root confirmation, explicit
subpath boundaries, ports, nested groups, suffix/trailing-slash semantics and unsafe inputs.
`issues.test.ts` also pins the dual-entry rule (`shouldPromptAssociation`), and the
`IssueAssociationBody` markup (rendered outside the client-only portal through the dialog root):
the host hint only prefills the editable address, exactly one shared form/token field/submit exist,
the skip control is present and stays present-but-disabled while a connect is pending, no
unsupported-host copy or fake connect error appears, and an SSH or
empty hint still opens the same skippable form. `associationDismissal` pins that pending dismissal is
refused on every channel, and `associationFormState.advancedToggle` plus the rendered form pin that the
disclosure's toggle exists only where it can change the disclosure.

`issues.test.ts` pins v103/v104 reads against the v105 auth floor (including a v103 panel that keeps
metadata with a disabled form yet shows no vault-persistence copy or reconnect invitation),
repository-address resolution and SSH/SCP guidance, the advanced instance prefill, consent
requirement, acknowledgment and its reset on instance change, the derived form-state gating
(`target`/`consentRequired`/`consentAcknowledged`/`canSubmit`/`authSupported`), input construction
refusing a missing token, token clearing before a failed submit, await-then-report disconnect
failure, the connect/list failure split, the reconnect state machine (success closes, failure keeps
the keyed error, a later list failure is not a connect failure, cancelling clears both the action and
the snapshot-level connect error), `issueSnapshotAfterLoad` keeping a same-identity snapshot's
summaries through a failed reconnect, stale-read dropping, and clearing a
stale action error when a fresh error-free snapshot lands. It also pins safe links, keyed panel
errors, reconnect coordinates rendered read-only, read-only summaries, the non-local HTTP risk
checkbox in both required and acknowledged states, and the supplied `onOpenIssue` launch control.

`issues.test.ts` pins the stage Actions surface too: the v104 launch, v108 implementation and v109 localized startup floors
(`supportsIssueActions`/`supportsIssueImplementation`), the pure `issueActions` matrix across every stage,
closed issues and each host floor separately (an old host keeps design and disables only implementation),
catalog text for every action and reason, the rendered row of controls on an in-progress issue with no
reason on a current host, no row at all for a closed issue or without a dispatch callback, a pending
action disabling every control, a tool-driven `actionError` rendering its key alone,
`runIssueAction` forwarding the host's `IssueSessionLaunch` once to the callback for both actions, the
call set carrying exactly `launchDesign`/`startImplementation` and no `designApproval`, a transport
failure and a malformed launch each becoming the keyed `issues.error.action` with zero launches, and a
guard that neither the action list nor the markup ever mentions merge or MR.
`shell/issueLaunch.test.ts` pins `openIssueSession`: it refreshes and stores the project's workspaces,
activates the returned workspace (also when the list omits it) with the session as the route chat target,
opens that chat tab, and — when the refresh fails — reports the keyed `shell.workbench.issueLaunchFailed`
toast and opens nothing.

Layout tests pin catalog/default rail placement. Existing color/spacing/typography adoption guards
cover this module.
