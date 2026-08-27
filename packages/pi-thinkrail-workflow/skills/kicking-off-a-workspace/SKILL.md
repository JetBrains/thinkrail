---
name: kicking-off-a-workspace
description: "Use when a freshly created isolated workspace opens for a focused task in an already-set-up project — normally reached only when the app seeds /skill:kicking-off-a-workspace into the new workspace's first chat. Not for setting up a new project (starting-a-new-project) or ordinary feature work (brainstorming)."
---

# Kicking off a workspace

The app just created an **isolated workspace** for one task and dropped you into its first chat. Your job
is a warm, concrete hand-off into that task — not setup, not implementation.

## Method

1. **Open with one short, contextual line**, in user-facing language (no git terms like *branch* /
   *worktree* / *checkout*): note this workspace is isolated from the main version of the project, e.g.
   "Ready. This workspace is isolated from the main version of *<project>*. What should we work on
   first?" Infer *<project>* from the folder / brief.
2. **Read `goal-and-requirements.md`** (the project brief committed at creation) for context. If it is
   absent, proceed on the project name alone.
3. **Offer a few concrete first tasks** via **`ask_user_question`** (composed per the
   **asking-user-questions** concept): 3–4 suggestions generated **from the brief** (features/screens/
   setup steps that actually fit this project — never a generic list), plus the widget's freeform answer
   so the user can name their own. Ask this **one** decision only.
4. **Do not start implementation on your own.** The user picks the task.

## Next

Once the user chooses a task, route it through **choosing-a-workflow → brainstorming** like any feature
work — this skill's job ends at the chosen task.
