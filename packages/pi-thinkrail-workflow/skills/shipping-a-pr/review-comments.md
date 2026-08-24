# review-comments.md — address comments, never blindly

Entry: an open PR has review comments to address. Saves nothing. Control continues at `checks.md`.

1. **Whole-PR read first.** Fetch every comment thread and the full diff (`gh pr view <n>
   --comments`, `gh api repos/<owner>/<repo>/pulls/<n>/comments --paginate`), then re-read the PR's changes
   end to end. Each comment is judged against the whole change, not just its quoted lines.
2. **Verdict per comment, before touching code**: *apply* (it's right), *push back* (it's wrong or
   misreads the design — say why, citing the spec or design), or *clarify* (genuinely ambiguous —
   ask the reviewer or the user). Batch the verdicts; surface them to the user whenever any verdict
   is push-back.
3. Apply the accepted ones as proper changes — the project's verification gates still apply —
   commit everything, confirm the tree is clean, and push. **Reply to every thread** only after
   the push lands: what changed and where (naming the commit), or the push-back rationale. Resolve
   only threads actually addressed.

Red flags:

- Patching exactly the quoted line without reading the surrounding design — "do not fix them
  blindly" is this doc's founding requirement.
- Replying "done" without a pushed commit that shows it.
- Silently skipping a comment — every thread gets an answer.

## Next

Read and follow `checks.md`.
