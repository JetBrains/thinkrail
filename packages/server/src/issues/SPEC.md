---
id: submodule-server-issues
type: submodule-design
status: active
title: Issue connection, GitLab reads and Tomato approval foundation
parent: module-server
---

## Responsibility

Own the host-only project binding and live connection lifecycle, bounded reads and low-level provider
writes for GitLab CE and GitHub, pure Tomato version/approval validation, and injected local publication/evidence
orchestration and an injected workspace/session coordinator. Host composition supplies the connection/list
wire handlers, metadata persistence and the OS credential-store adapter; a separate concrete host workflow receipt adapter exists
and is composed by server-only host actions. The exported workspace coordinator has a concrete host persistence
seam and is composed by server-only host actions. Stage publication and draft delivery use independently confirmed host operations; CI and merge authorization remain outside them. See the
[approved workflow design](../../../../docs/plans/2026-11-04-issues-workflow-design.md).

## Public surface

`index.ts` exports `createIssuesService`, `IssuesService`, `IssuesServiceOptions`, `IssueBinding`,
and `IssueBindingPersistence`, `IssueStoredBinding`, and `IssueCredentialStore`. The async factory loads
and validates metadata only: startup never touches the vault or network. The required
`credentialStore` option has `get(id): Promise<string | null>`, `set(id, token): Promise<void>`,
and `delete(id): Promise<void>`; no memory/plaintext fallback exists. Persistence loads stored
bindings and atomically upserts one stored binding by local project id. Stored bindings extend
public bindings with optional UUID `credentialId`, exact canonical `httpConsentInstanceUrl`, and
at most 32 distinct UUID `cleanupCredentialIds` (never the active key). Explicit projections expose
only public binding fields plus connection status; opaque credential IDs are not public DTOs.
A local project holds exactly one binding, keyed by its local project id: associating a different
instance, provider or remote project replaces that row and retires the previous credential instead of
adding a second association, so a project is GitHub, GitLab or unassociated — never both. Records keyed
by the previous reference (sessions, receipts, workspace ownership) simply stop resolving through
`remoteFor`, which compares the live binding exactly.

`content(localProjectId, reference)` returns only `{ description, url }` for the exact live binding,
using `IssueRemote.issue` without notes, workflow state or writes. The URL comes from the verified
project path. A connection replacement or disconnect during the read rejects its result. Closed issues
and untrusted local projects retain this read capability.

`detail(projectId, reference)` reads a complete body/comment snapshot through the live exact binding,
rejects connection changes and mismatched Issue IIDs before reading comments, excludes GitLab system
notes, and orders ordinary comments by creation time
then id. Provider author name/username is projected without profile URLs; absent/deleted authors are null.
Pagination limits and failures fail the whole read rather than returning partial comments.

`connection`, `connect`, async `disconnect`, and `list` expose the lifecycle; `restore(projectId)` is
a server-only lazy asynchronous seam, not a wire contract. Host composition supplies both adapters.

`deliveryFor` returns the provider-neutral Issue write and draft-request surface for an exact live binding, checking provider identity as well as instance/project. The barrel exports its `IssueDeliveryRemote`, `IssueRecord` and `IssueMergeRequest` types. It grants no user authorization.

`remoteFor(localProjectId, reference)` is a synchronous server-only capability lookup, not an RPC
or workflow action. It validates the full reference and requires a live client plus exact canonical
instance URL and verified numeric remote project id equality with the current binding; the provider
follows the instance host through `issueProviderForInstanceUrl`, never the caller. It returns the
neutral read port, never reconstructing a client from persisted metadata and never exposing a token
accessor. `workflowFor(localProjectId, reference)` is the GitLab-only companion: it refuses a
non-GitLab provider with a static `RESOURCE_UNAVAILABLE` before any request, then returns the same
client narrowed to the workflow surface. The lookup snapshots current connect state; callers must obtain
it for each operation. A previously returned client is not revoked by later disconnect/reconnect, and
this seam does not provide operation-wide connection-change detection or workflow authorization.

`github.ts` implements the same neutral read port against `https://api.github.com`: `Bearer` token,
`application/vnd.github+json` and a pinned `X-GitHub-Api-Version`; `owner/repo` while associating and
`/repositories/<id>` afterwards; the issues endpoint filtered by `pull_request` absence, `open`/`closed`
mapped to the workflow's stage words, comments read and created as notes, `Link rel="next"` pagination
bounded to `api.github.com`, and the same byte, deadline, redirect and token-echo refusals as GitLab.
A rejected request logs only its status; 401, 403 and 404 keep distinct readable reasons.

The barrel also exports `createGitLabClient`, its options and read models, `tomatoLabels`,
`designVersion`, `implementationVersion`, `approvalPublication`, `validateApproval`, and their types.
The client port includes `project()` and authenticated instance-scoped `currentUser()` (only numeric
`id`, via `/api/v4/user`, never a project-relative user path). It reads project metadata, issues,
notes, complete resource label events and effective project membership (`/members/all/:userId`, including inherited membership). `client.ts` additionally
exposes issue description/label updates, note creation, issue closure, source-branch MR lists, fresh MR
detail, MR creation, and SHA-conditional merge. These are provider primitives, not workflow actions or
permission to merge. Provider input/read types are exported through the barrel.

## Connection and read invariants

- `connect` validates through shared `canonicalIssueInstanceUrl` / `hasIssueHttpConsent` before
  any PAT request. Non-loopback HTTP requires consent for the exact canonical instance, either
  explicit input or host-stored acknowledgement; restore cannot synthesize it. PATs are preserved
  exactly and must contain 1-4096 printable ASCII characters strictly above 32 and below 127.
- Connect is exclusive per local project. Verify project and numeric selection before allocating a
  fresh UUID. Save its cleanup marker while retaining the old binding/client, then set the fresh
  vault key; never overwrite an active credential. Save the replacement active key plus old-key
  cleanup debt before installing its client. Delete retired keys and save cleared markers only
  after confirmed deletion. Changed instance/project bindings retire the previous key too.
- Before replacement commit, failures preserve the old active key and client. An uncertain new
  vault write is deleted under its staged marker; failed deletion retains that marker. After commit,
  retirement failure reports a static error but the new binding remains live: it is not rollback.
  These are durable marker semantics, not an atomic transaction across JSON and the OS vault.
- `restore` coalesces concurrent calls, first cleans recorded debt, then gets the active key,
  requires stored HTTP acknowledgement, verifies the numeric project identity and safe path, and
  installs only if the operation is still current. Missing keys remain disconnected. Vault errors
  are static; no automatic retry loop or eager startup vault/network access exists.
- Disconnect immediately removes the live client and cancels pending installation. Its promise
  waits for pending connect/restore settlement, saves no-active metadata with all known keys as
  cleanup debt, deletes them, then saves cleared markers. Failure is reported and leaves runtime
  blocked, never apparent success. New connect/restore calls cannot proceed during disconnect or
  after failed disconnect; repeating disconnect retries cleanup. All asynchronous boundaries guard
  cancellation before subsequent dispatch/installation. Serialization is process-local only, not
  a multi-host lock. Existing previously returned client capabilities remain outside revocation.
- Tokens exist only in the injected host OS vault and transient process memory, never metadata,
  public snapshots, URLs, logs, agent context, errors or causes. Host owns the concrete vault
  adapter; this module does not import Bun.secrets or promise cross-store atomicity.
- `list` requires a live client, discards reads across a connection change, and maps fresh reads to
  public summaries with provider-qualified references and links built from the verified project path.
  It preserves ordered label names for stage derivation and projects optional provider label colors
  separately; GitLab requests detailed labels in the existing list call, while GitHub uses its returned
  label objects. Invalid color metadata is omitted without invalidating an otherwise valid issue. It
  omits descriptions and does not cache or expose approval/action state. Listing never guesses
  beyond a default: closed is `closed`, exactly one recognised label maps its stage, and everything
  else (no label, an unknown `workflow::*` label, or several of them) reads as `backlog` with the
  labels shown verbatim. Stage actions remain strict - `checkIssue` still refuses unknown or
  conflicting labels before any write, so a read default cannot advance a workflow. A list failure
  never denies the association itself.
- The low-level client accepts credential/query/fragment-free HTTP(S) URLs; HTTP is also available at the service boundary under the shared explicit-consent gate. Redirects are rejected, not followed with a PAT.
- A request has a hard deadline covering fetch and streamed body, byte cap, schema validation and
  static CodedError failures. Lists have page/item caps and must complete; a truncated list is an
  error, never approval evidence. No retries, especially no uncertain mutation retries.

## Provider write and MR contract

`IssueDeliveryRemote extends IssueRemote` adds partial issue updates, single-attempt Issue close, exact-source-branch
MR/PR listing and MR/PR creation using the shared `IssueMergeRequest` model. `IssueWorkflowRemote`
extends that delivery port with GitLab-only approval evidence and merge operations. `GitHubClient`
exposes the delivery port; `remoteFor` deliberately remains the read/comment port. These types grant
no workflow authorization. Provider closure responses expose nullable `closedAt`; the confirmed host
operation requires a non-null read-back before returning a close receipt.

GitHub updates use PATCH with only supplied fields (`description` maps to `body`), so label-only
writes never replace the description. PR operations first read verified repository identity/path;
all-state lists use `head=<verified owner>:<exact source branch>` and bounded complete pagination
whose next links must preserve the endpoint and filters. Returned PRs must match the verified source
and target repository, exact source branch (and requested target on creation), and canonical
`https://github.com/<verified path>/pull/<number>` URL. Fork/deleted-repository heads fail closed.
Absent optional draft/merge metadata remains unknown; pipelines and squash SHA are unknown.
Malformed delivery responses fail with sanitized `RESOURCE_UNAVAILABLE`, without retry.

- `updateIssue(iid, { description?, labels? })` replaces only supplied fields; an empty label array
  clears labels. Labels cannot contain commas because GitLab receives a comma-separated string.
  `addNote(iid, body)` publishes a note; `closeIssue(iid)` sends the close state event.
- `project()` returns numeric id/path plus nullable `defaultBranch`, `httpUrlToRepo` and
  `sshUrlToRepo`. A numeric project selection (including a numeric string) must match the returned id.
  Default branches must be valid branch names; no default such as `main` is guessed. Returned HTTP(S)
  clone URLs must be canonical and credential/query/fragment-free, so a self-hosted HTTP-only
  instance keeps its own scheme instead of failing the project read. SSH URLs allow username-only
  `ssh://` and scp-style forms, never passwords, queries or fragments.
- `mergeRequests(sourceBranch)` reads all states and all pages for the exact source branch;
  `mergeRequest(iid)` reads fresh detail. MR metadata includes numeric id/iid, credential-free
  HTTP(S) web URL, state, source/target branch, nullable full commit SHA and merge status. Delivery
  facts add nullable `sourceProjectId`, `targetProjectId`, `draft`, `detailedMergeStatus`,
  `mergeCommitSha` and `squashCommitSha`. Nullable `headPipeline` carries nullable numeric `id`,
  nullable full `sha` and required nonempty `status`. Omitted/null optional wire fields decode as
  null (unknown); present malformed values fail with static sanitized `RESOURCE_UNAVAILABLE`.
  A successful pipeline status without SHA/identity is not proof of passing CI for the MR head.
- Project and current-user reads use the same authenticated headers, redirect rejection, hard
  fetch/body deadlines, byte caps, token-echo rejection and sanitized errors as the provider writes;
  they are single-attempt and never expose a token accessor. These facts are primitives for future
  fail-closed delivery policy: they do not authorize merge or implement MR/CI orchestration.
- `createMergeRequest({ sourceBranch, targetBranch, title, description, draft? })` creates a provider MR.
  GitHub sends the native boolean `draft` flag when supplied and validates the returned flag;
  GitLab uses the CE-compatible `Draft:` title prefix for `draft: true`, preserving existing
  `Draft:`/`WIP:` prefixes. Omission preserves ordinary creation behavior.
  `mergeMergeRequest(iid, sha)` sends a full SHA as GitLab's merge precondition; after the single
  write it performs bounded MR readback. `mergeEvidence(iid)` reads fresh MR detail, the exact named
  target branch SHA from the verified project/repository, and compares the provider-reported merge
  commit against that target. It returns the exact observed merge/target SHAs and an explicit
  `ancestor`, `not-ancestor`, or `unknown` relationship with a snapshot. Merged state or target SHA
  alone is never ancestry evidence; missing merge SHA or incomplete compare evidence remains
  unknown. This does not authorize merge, prove approval/CI, or close the issue itself.
- Writes are single-attempt with bounded response reads and no automatic retries. Non-2xx responses,
  transport failures, deadlines, token echoes, and malformed success bodies (including mismatched
  resource iids) yield static, sanitized `RESOURCE_UNAVAILABLE` errors without causes. An error does
  not establish that GitLab rejected the write: callers must reconcile fresh remote state before
  deciding whether to retry. Inputs are validated before dispatch, and credentials cannot appear in
  write bodies or branch query URLs. Returned MR links and clone URLs accept credential-free
  HTTP(S) so an HTTP-only instance is usable; only the scheme is relaxed.
- No service orchestration or workflow authorization is added by these primitives. Target-instance
  CE compatibility, approval, role checks, CI policy, and merge authorization remain separate gates.

## Approval invariants

- Design versions hash exact UTF-8 design text; implementation versions bind a full commit SHA and
  approved design digest. No timestamp or current label alone proves approval.
- Approval needs the matching remote publication note, current version equality, a confirmed absent
  label reset at the recorded event boundary, a subsequent fresh add, and effective Developer+
  membership. Full event history must have unambiguous ID/time ordering; removal, changed versions,
  missing evidence, unavailable roles, or concurrent snapshot changes fail closed.
- GitLab web approval and app-originated approval are equivalent: both are proven from the fixed
  approval label, its post-reset add event and fresh effective membership. An app approval leaves its
  own remote label record; it does not create a second publication note or a local-only decision.
- Future workflow orchestration must obtain all evidence directly from fresh remote reads, persist
  reset and publication receipts without secrets, and recheck snapshots around these reads. The pure
  validator does not fetch, trust agent assertions, authorize merge, or make torn reads atomic. Its
  input includes matching before/after remote revisions; callers must not fabricate those revisions
  from timestamps.

## Local publication and evidence orchestration

The barrel exports `createIssueWorkflow` and its `IssueWorkflowOptions`, `WorkflowRemote`,
`WorkflowReceipt`, `WorkflowRecord` and `WorkflowPersistence` types for server-only host composition.
These are not wire actions; host ingress owns authorization and operation-wide capability guards. Its injected
`clientFor(reference)` returns a live, credential-free client port; `WorkflowPersistence` loads trusted
per-provider-qualified-reference records and atomically/durably compare-and-sets revisions. A concrete
adapter must serialize all writers, including across host instances. Records contain only receipt,
version, approval and pending-operation metadata, never credentials or client objects.

- `publishDesign` checks the exact expected description, clears both approval labels while preserving
  unrelated labels, confirms the absent reset against complete event history and fresh issue snapshots,
  writes the design, publishes the fixed approval note and persists its note id/version/event boundary.
- `publishImplementation` requires a locally approved design receipt and freshly proven remote design
  approval, binds a full commit SHA to that digest, resets the implementation label and publishes a new
  receipt. New designs discard implementation receipts; new commits replace their prior receipt.
  The required host `currentImplementationCommit(reference): Promise<string>` port reads the actual
  current implementation checkout commit, never a receipt or caller assertion. Full SHAs are validated
  through `implementationVersion`; invalid/unavailable reads stop with a static error. Publication's
  supplied SHA must match before reservation and before subsequent remote writes and receipt completion.
  Implementation evidence derives its current version from a fresh host SHA plus the current design
  digest, brackets evidence reads with that same commit, and rechecks the revision boundary before
  reservation, label transition and approval completion (including the already-approved fast path).
  A mismatch never advances the stage; uncertainty after reservation leaves pending reconciliation.
  Design-only operations never invoke this port. These reads cannot eliminate an external Git change
  after the last check; the host port supplies observations, not a Git lock.
- `validateDesign` / `validateImplementation` read fresh issues around notes, complete events and
  effective approver membership. Revision digests include updatedAt, exact description, labels and state.
  Marker comments cannot bootstrap local trust. Successful validation persists approval and transitions
  only known workflow labels, preserving unrelated labels; conflicting or unknown workflow labels stop.
- `approveStage(reference, stage)` is app-originated approval over the same receipts and machinery. It
  refuses a pending record and requires the stage receipt to exist. It then re-reads the issue and
  requires the receipt version to equal the fresh current version: the exact description digest for
  design, or for implementation an approved design receipt whose publication version equals the fresh
  design digest together with a fresh `currentImplementationCommit` HEAD that rebuilds the receipt's
  implementation version. A stale version is never approved. The actor and the actor's effective role
  are read fresh from the provider (`currentUser()` then `member(id)`); a role below numeric Developer
  (30) or an unknown actor stops with the unchanged static error. The caller supplies no actor id, role
  or version.
- Only when the stage label is absent does `approveStage` reserve the durable
  `approve-design`/`approve-implementation` pending operation before its single
  `updateIssue({labels})` write, which adds that label and preserves unrelated labels. It then re-reads
  the issue around the complete label events, requires one stable revision boundary, and requires the
  newest post-boundary event for that label to be an `add` authored by the current actor. Only then does
  it run the existing validation path, which persists `approved: true` and the workflow label
  transition. Another actor's label add, a stale version, a torn boundary or any mismatch after the
  reservation stops with the existing reconciliation error and leaves the reservation pending. A
  repeated app approval of an already recorded approval is idempotent: it writes no label, note or
  record revision. Approval never merges, pushes, creates a merge request or CI work, and is not merge
  authorization.
- Before any remote write, a durable pending operation is reserved using compare-and-set. Failure or
  uncertainty leaves it pending. All subsequent operations stop with a static reconciliation error;
  there is no replay or automatic recovery. Reconciliation/human repair is a separate future seam.
- These checks do not provide remote compare-and-swap: GitLab can still change after a read. No merge,
  push, MR or CI orchestration is supplied or authorized by these local receipts.

## Confirmed stage and delivery operations

The host binds a complete sanitized report and fresh Issue revision to an immutable session operation.
Only the exact questionnaire and its submitted `Looks right` receipt authorize execution. Skip, discuss,
custom text, superseding messages and changed previews grant no authority. Durable intents precede any
mutation; completed operations return the same receipt, while unresolved ones stop without replay.
Design confirmation accepts only an absent workflow label or `workflow::backlog`, publishes the report,
and moves that label to `workflow::in-progress`. Implementation confirmation accepts only
`workflow::in-progress`, binds a completed design and each selected clean checkout SHA, then moves
the label to `workflow::in-review`. This source-to-target transition is identical on GitHub and GitLab.
Comment and resulting labels are re-read; unrelated labels and the Issue body are preserved. Unknown,
conflicting, closed or concurrent state is refused unless an explicit one-shot warned card is requested
for the supported stage policy exceptions; the card states actual labels/state/receipt gaps, and execution
rechecks frozen facts. Unsupported exceptions do not silently proceed. This new confirmation path does
not use legacy GitLab approval labels or grant permission to start another stage.

Delivery is separately confirmed per repository, fixing the commit, authenticated repository identity,
canonical push URL, source/target branches and complete draft text. Non-force push uses the exact SHA;
Only active opened PRs/MRs are reusable candidates; merged/closed requests stay in provider and journal
history without blocking subsequent requests for the same Issue or branch. A removed remote source
branch is recreated by ordinary confirmed push. One matching opened PR/MR at the same SHA is reused without editing. An older head on that same
source/target repository and branch is updated by the confirmed non-force push, then re-read to verify
the same request id/iid now points at the new SHA; it is never replaced by a duplicate. Otherwise only a
Draft PR/MR is created.
Automatic commits, force push, merge and Issue closure are outside this surface. Delivery failure
reasons and journal status are inspectable; deterministic preflight happens before intent reservation.
Post-write uncertainty retains its intent and blocks blind replay. Read-only inspection exposes
status/reasons, and receipt adoption requires a frozen observed-result card, original-process-ended
human confirmation, and a fresh remote recheck before completing the original intent. Stage exact-body
matching alone does not prove note authorship; the adoption card discloses that limitation. Automatic
or user-authorized resend after unresolved uncertainty remains unimplemented.

## Workspace/session coordination

Repository selection is stored on the provider-qualified workspace ownership record as optional
`repositoryProjectIds`; absence means an empty selection for old records. The coordinator exposes
`repositories` and `setRepositories` under the same local-project launch serialization. Selection
contains at most 32 distinct local project ids excluding the primary, and becomes immutable as soon
as implementation preparation reserves ownership, including a failed preparation. Host composition
validates that selected projects are open and available before saving or launching; selection grants
no resource trust. Recovery preserves the selection together with both stage records. Optional `members` freezes the
ordered auxiliary project ids at preparation start and stores each pending/completed ownership
separately. Auxiliary paths are source-repository `.worktrees` direct children named with the Issue
number and a stable digest of the full primary binding; reserved branches remain unpredictable.
Every auxiliary member is verified before a primary session may be created or reused. Missing completed
members stop instead of being recreated; partial preparation retains successful worktrees.

**Project groups.** Nothing is selected by default: an Issue starts with only its primary worktree, and
the other repositories it may touch are offered as read-only references (below) that join on demand.
Optional `layout(projectIds)` may return `{ root, paths }` — a shared folder and the `/`-relative place
of every participant **plus every other open group member found where it belongs** — when preparation
freezes the members (even with an empty selection, so later joins share the slot); it is stored on the
record as `layout`, its places are never moved, and a join only appends the place of a member imported
after the freeze. A project outside the layout (a non-group project, or a member whose place drifted)
joins with an ordinary per-repository path. A record without a layout and without selection keeps the
exact single-repository shape (no `members`). With a layout every checkout, primary included, lives at
`<root>/.worktrees/<slot>/<place>`, so repositories keep their relative layout. The slot name is
uniform — `issue-<IID>-<binding digest>` whichever member is primary (no member is special for sitting at
the group folder; the folder is usually a plain non-Git folder) — and is frozen into `layout.slot` with the
layout. A record frozen before `slot` existed keeps its original name (`issue-<IID>` when its primary sat at
the group folder itself, else the same digest form). Creation runs shallow-first, so an outer checkout exists before a
nested one is placed inside it, and the `layoutRoot` is passed to `createWorkspaceAtPath`. Lookups
(`ownedImplementation`, `contexts`) derive paths from the frozen layout. The session cwd stays the
primary's own worktree — never a group folder no workspace owns — so one cwd keeps one identity. Host wiring
must supply project-aware lookup ports before exposing this coordinator capability to clients.

**On-demand joins.** `addRepository(reference, id)` before preparation appends to the saved selection;
after it, the add-only join reserves the member (same pending/completed ownership, appended to both
`members` and `repositoryProjectIds`) and creates its worktree at once in the frozen slot. A member whose
place would contain an already joined checkout (an ancestor joined after its descendant — including a
repository at the group folder itself, which is a member only when that folder is a repository) is refused with `ISSUE_REPOSITORY_REFUSED` — Git cannot add a worktree over a non-empty folder —
as is one whose place a joined checkout already tracks, and a 33rd member; an empty folder left at the
place is cleared first. A refusal passes the coordinator's and the launch fence's catch-alls unchanged
(and the fence is released), so it never leaves the Issue needing reconciliation. Every new **member**
worktree — initial or joined — branches from the optional `baseRef(id)` port (a freshly fetched remote
default branch, or undefined for local HEAD); the primary uses it only when the record has a layout, so a
non-group single repository keeps branching from its local HEAD. The optional `headCommit` port records
the started commit as the member's `base`.

**References.** The optional `references()` port lists the other repositories' main checkouts;
`contexts` appends every one that is not joined (nor mid-removal) with `role: "reference"`, after the
primary and joined entries, in both stages. References are readable context only: they are not
editable session members, and the startup prompt names `issue_join_repository` as the way to ask.

**Cleanup.** `cleanupRepositories(reference)` walks joined members deepest first and removes one only
when it has a recorded `base`, no other joined checkout inside it, a verified worktree, and the
`memberUnchanged` port says it has no commit beyond `base` and no tracked or untracked change. It first
persists `removing: true`, then calls `removeMember` (which re-checks, archives and deletes the
unchanged reserved branch), then drops the member and the empty folders it left inside the slot.
`implementation`, `addRepository` and `cleanupRepositories` first settle any recorded removal —
finishing it, or clearing the mark when the member changed meanwhile — so a crash mid-removal is
recoverable. The primary is never removed. A removed member reads as a reference again and can rejoin.

The exported workspace coordinator uses injected existing-workspace and session ports, not a second
store or runtime. It reserves a provider-qualified ownership record before creating exactly
`.worktrees/issue-<IID>`, persists the registered workspace before starting a session, and reuses recorded
sessions in either idle or busy state. Returning an existing session for navigation does not prompt,
stop, or restart it; actually starting its initial prompt remains idle-only under the host session-start
contract. A missing session is replaced only under a durable pending marker. A pending create is recoverable only when both Git registration and a managed workspace match
its reserved branch/path; it never adopts an unrelated checkout, overwrites a destination, chooses a
suffix, deletes a checkout, or starts a prompt in a busy session. A pending create that left no
directory, no Git worktree entry and no workspace registration created nothing, so it is re-reserved with a fresh branch
rather than blocking. Session creation also requires a durable pending marker before the side effect.

That marker is reconciled only from evidence the host already recorded: the session it bound for the
same stage and workspace (written immediately after creation, before the association save). When that
binding exists the launch adopts it; when it does not, nothing bound the stage and the marker is
cleared so the action can run again, accepting at most one unreferenced session if a process died
between creation and binding. Launch actions reconcile; read-only lookups such as
`ownedImplementation` keep refusing any marker without writing. The host composes the coordinator under its durable launch fence. Host composition must use the server-only exact-branch
workspace capability; the generic name-to-unique-branch API remains unsuitable.

A completed implementation is never implicitly recreated. Explicit recovery is available only when
its recorded directory, Git registration and workspace registration are all absent and no pending
effect exists; confirmation snapshots include old ownership, frozen member set and commit starts, and
execution rechecks them under the same launch fence. Prior generations retain workspace/path/branch/
session identity and archive time. Partial absence, path conflicts and uncertain state remain refusal
cases.

`implementation(reference)` requires no design approval, version, workflow-label transition or
readiness port. It creates or reuses the exact owned workspace and returns a recorded implementation
session in either idle or busy state; a missing session is replaced only under a durable pending marker.
Returning a busy session is navigation-only and does not start another prompt. Starting design or
implementation is not publication, approval, merging or closing an Issue.

A completed implementation whose checkout, Git registration and managed workspace are all absent can
only be replaced through explicit recovery: diagnostics are read-only, execution rechecks the frozen
ownership/member/base snapshot under the same launch fence, and prior generations remain in history.
Partial absence, occupied paths and uncertain pending effects fail closed.

`implementationRecovery(reference)` binds a SHA-256 snapshot to the Issue identity, prior generation,
every missing member, and the exact commit chosen from the old branch (or a freshly resolved restart
commit when that branch is absent). Execution re-diagnoses under the per-Issue launch fence; changed
facts invalidate confirmation. It archives the old primary session id and ownership before reserving
fresh checkout ownership. Healthy group members remain owned; only wholly absent members are rebuilt.
Pending reservation evidence retains each selected commit so a provably empty failed creation can resume
without changing its base.

Issue archive waits for pending teardown before recovery can proceed. Issue-owned transcript preservation
is separate from ordinary workspace removal: live sessions/resources are stopped and disposed, but pi
JSONL remains. History reads select the recorded session id without attaching a session; cwd-wide
sessions are never treated as one generation.

`ownedImplementation(reference): Promise<WorkspaceHandle>` is lookup-only: it requires a completed
record with exact local project/provider identity, recorded workspace id/path/branch, a managed
workspace, and exactly one matching nonprunable Git registration. The derived canonical project
root's `.worktrees/issue-<IID>` and its parent must be real directories, not links. Missing or pending
ownership and any session-pending fence fail closed; lookup never creates, adopts, recovers, saves,
or inspects/starts sessions. Future host current-HEAD verification must use this owned worktree,
never a caller-supplied path or SHA. This lookup observes ownership, not a Git lock.

## Session startup context

`session.ts` is a pure startup-prompt boundary, not a session service or lifecycle store. Its prompt
factory and association/context types are exported through the Issues barrel for host composition.
`BoundIssueSession` records `sessionId`, `workspaceId`, local `projectId`, provider-qualified
`reference`, explicit `stage: "design" | "implementation"`, and effective `locale`. It contains no
client, binding, credential or approval state. `IssueStartupContext` optionally includes host-projected repository entries with local project/workspace
ids, display name, actual path and primary/associated/reference role. They are data, not executable configuration;
the prompt requires per-repository instruction lookup, forbids combining project configuration, and
states that membership is not a shell sandbox or proof that cross-repository builds work.
`contexts(reference, stage)` verifies source Default directories for design and every recorded completed
worktree for implementation without creating implementation directories. Host composition refreshes
this projection at startup and on bound `issue_context` reads; the pure prompt factory performs no I/O.

`IssueStartupContext` accepts a reference,
`GitLabIssue`, complete `GitLabNote[]` as `notes`, verified Issue `link`, explicit stage and locale;
callers must finish all note pagination before calling. Completeness cannot be proven from an array.

`createIssueStartupPrompt(context)` begins with `/skill:tomato-issue-workflow ` (a literal space
before arguments, as required by the SDK parser), names the stage and
response locale, and instructs reading the entire context. Design delegates to the existing ThinkRail
brainstorming process without implementation; implementation uses existing plans/TODOs, verification
and review without a design approval gate. Both require confirmed `issue_record_summary` publication
to the bound Issue comments before conclusions or yielding, including blocked/partial work, with key
decisions, results, validation and next steps only. Failed context reads, mismatched Issue identity,
and failed/uncertain publication block success. The prompt adds no agent-side completeness gate;
[[submodule-tomato-issue-workflow]] owns how the agent uses returned context and relevant references.
The startup reminder requires full referenced design/plan artifacts with ordered, confirmed parts;
[[submodule-tomato-issue-workflow]] owns the detailed publication rules. This is an agent instruction,
not host file access or completeness enforcement. Transcripts, internal reasoning, raw tool output
and secrets must not be published.

The reference uses the shared strict action identity guard. Links must be canonical credential-free
HTTP(S), on that instance beneath its base path, ending in `/<project path>/-/issues/<bound IID>`;
the caller still owns verifying that path against the numeric remote project. Locale must be an
effective canonical BCP-47 tag (shared 35-character bound), never `system`; English and Chinese have
explicit language instructions and other tags get a BCP-47 language instruction. Only explicitly
projected Issue/note fields enter a JSON block marked untrusted external data. JSON escapes angle
brackets and line separators so supplied text cannot close its delimiters; raw data cannot override
stage, language, workspace rules or tool permissions. No project configuration or PAT input exists.
The whole UTF-8 prompt is capped at 128 KiB; excessive context fails with a static error rather than
silently truncating any description or comment. No I/O, new dependency, host/agent/UI integration,
worktree/session creation, or side effects belong to this slice.

## Dependencies and forbidden reaches

Bun/Node platform APIs, `@thinkrail/shared/codedError`, and root `@thinkrail/contracts` issue DTOs and
validators. No host, concrete persistence, agent, workspace, subprocess, or web imports. Parent
server spec owns the dependency edge.

## Verification

Adjacent tests use injected fetch and disposable local HTTP, never production credentials. Validate
connection lifecycle, public binding projection, read mapping and fail-closed workflow labels, bounds,
pagination, response shapes, sanitized errors, fresh version-bound Developer+ approval, the
implementation start gate (backlog transition, in-progress/in-review idempotence, refused labels,
retained reservations) and version-free session reuse across re-entries. Target CE
compatibility and full workflow integration remain separate delivery gates.

Workspace handles admit the shared `chat` kind as input, but every ownership/default validation
rejects it: Issue work always requires a real project checkout. Projectless chats cannot be Issue targets.
