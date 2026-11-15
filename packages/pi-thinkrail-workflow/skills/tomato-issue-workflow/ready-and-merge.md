# 06 — Ready and merge

Entry: a Draft/active request is identified and the user-selected policy or separate confirmation explicitly authorizes ready/merge. Save fresh preconditions and the actual target-branch result.

## Trigger and entry state

Use only when the requested scope includes marking ready or merging. Draft delivery confirmation alone is insufficient.

## Automatic steps

1. Read fresh request identity, repository, source/target, head SHA, CI/checks and required approvals.
2. Confirm host/provider supports each requested mutation and read-back before promising completion.
3. Recheck all frozen facts immediately before each mutation; ready and merge are distinct operations.
4. After merge, read the request's merged state and the actual target branch SHA; verify target identity and record available merge SHA.

## Host capabilities

The current confirmed delivery host operation does not authorize ready or merge. Issue/provider primitives, where present, are not an authorization path. GitHub and GitLab support must be assessed separately; no shell or direct provider API bypass is allowed.

## Completion, questions and recovery

Do not infer completion from a `merged` state alone. If target or head changes, re-evaluate and obtain the authorization required for the changed operation. On uncertain writes inspect/reconcile the original operation before continuing.

## Handoff

Only after observed target-branch SHA matches the intended target report merged completion. For downstream pairing route to `cross-repository.md`; otherwise return to `issue-acceptance-and-close.md` for acceptance.
