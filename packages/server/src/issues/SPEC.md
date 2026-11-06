---
id: submodule-server-issues
type: submodule-design
status: active
title: Issue connection, GitLab reads and Tomato approval foundation
parent: module-server
---

## Responsibility

Own the host-only project binding and live connection lifecycle, bounded GitLab CE reads and
low-level provider writes, pure Tomato version/approval validation, and injected local publication/evidence
orchestration and an injected workspace/session coordinator. Host composition supplies the connection/list
wire handlers, metadata persistence and the OS credential-store adapter; a separate concrete host workflow receipt adapter exists
and is composed by server-only host actions. The exported workspace coordinator has a concrete host persistence
seam and is composed by server-only host actions. MR/CI authorization and a GitHub adapter are not implemented. See the
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
`connection`, `connect`, async `disconnect`, and `list` expose the lifecycle; `restore(projectId)` is
a server-only lazy asynchronous seam, not a wire contract. Host composition supplies both adapters.

`remoteFor(localProjectId, reference)` is a synchronous server-only capability lookup, not an RPC
or workflow action. It validates the full reference and requires a live client plus exact GitLab
provider, canonical instance URL and verified numeric remote project id equality with the current
binding. It returns the already-authenticated client, never reconstructing one from persisted metadata
and never exposing a token accessor. The lookup snapshots current connect state; callers must obtain
it for each operation. A previously returned client is not revoked by later disconnect/reconnect, and
this seam does not provide operation-wide connection-change detection or workflow authorization.

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
  It omits descriptions and does not cache or expose approval/action state. Listing never guesses
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
- `createMergeRequest({ sourceBranch, targetBranch, title, description })` creates a provider MR.
  `mergeMergeRequest(iid, sha)` sends a full SHA as GitLab's merge precondition; it does not schedule
  auto-merge, authorize the workflow, prove approval/CI, or close the issue itself.
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

## Workspace/session coordination

The exported workspace coordinator uses injected existing-workspace and session ports, not a second
store or runtime. It reserves a provider-qualified ownership record before creating exactly
`.worktrees/issue-<IID>`, persists the registered workspace before starting a session, and reuses recorded idle
sessions. A pending create is recoverable only when both Git registration and a managed workspace match
its reserved branch/path; it never adopts an unrelated checkout, overwrites a destination, chooses a
suffix, deletes a checkout, or prompts a busy session. Session creation also requires a durable pending
marker before the side effect; failure to save its resulting association blocks all subsequent launches
until reconciliation instead of creating duplicate sessions. The host composes the coordinator under its durable launch fence. Host composition must use the server-only exact-branch
workspace capability; the generic name-to-unique-branch API remains unsuitable.

`implementation(reference)` requires no design approval, version, workflow-label transition or
readiness port. It creates or reuses the exact owned workspace and recorded idle implementation
session; busy sessions still stop, and a missing session is replaced only under a durable pending
marker. Starting design or implementation is not publication, approval, merging or closing an Issue.

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
client, binding, credential or approval state. `IssueStartupContext` accepts only a reference,
`GitLabIssue`, complete `GitLabNote[]` as `notes`, verified Issue `link`, explicit stage and locale;
callers must finish all note pagination before calling. Completeness cannot be proven from an array.

`createIssueStartupPrompt(context)` begins with `/skill:tomato-issue-workflow ` (a literal space
before arguments, as required by the SDK parser), names the stage and
response locale, and instructs reading the entire context. Design delegates to the existing ThinkRail
brainstorming process without implementation; implementation uses existing plans/TODOs, verification
and review without a design approval gate. Both require confirmed `issue_record_summary` publication
to the bound Issue comments before conclusions or yielding, including blocked/partial work, with key
decisions, results, validation and next steps only. Missing/uncertain context or publication blocks
success; transcripts, internal reasoning, raw tool output and secrets must not be published.

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
