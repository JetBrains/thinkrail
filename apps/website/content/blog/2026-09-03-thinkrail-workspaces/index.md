---
title: ThinkRail Workspaces
slug: thinkrail-workspaces
date: 2026-09-03
author: maciej-gorywoda
excerpt: Working directly on the project folder can be unsafe - an isolated workspace might be a solution
tags:
  - thinkrail
  - workspace
---

When you start a project in ThinkRail, you have two options: work directly in the project folder or create a new workspace. 
Working directly on the project folder means that all changes will immediately affect the current git branch. 
This is straightforward but can also be unsafe. Unsaved changes may be removed by the AI agent. Saved changes could 
still be overwritten if the agent has permissions to perform certain git operations.
Moreover, while you still can use more than one AI agent at once when working in the project folder, you risk that 
they will get in the way of each other. A workspace might be a solution to both those issues.

## Create an isolated workspace

To create a workspace, click the "Start building" button. In the new window, select the git branch for your workspace 
and provide a description. This description serves as both the human-friendly workspace name and the initial prompt 
for the AI agent. (but  note that the AI agent may later rename the workspace for conciseness). Once created, 
the workspace launches a new chat with an AI agent, which immediately begins working on the task.

A key feature of workspaces is their isolation. After the AI agent makes changes, opening the project in your IDE 
will still show the original version. This is because the updated code resides in a separate worktree directory under 
the `~/.thinkrail`, for example `~/.thinkrail/worktrees/<project-name>/workspace-1`. All changes made by the AI agent 
are safely contained and will only be propagated to the parent branch when you request it.

<iframe src="https://youtube.com/embed/RhxFnVy9vaU" width="640" height="360" allow="autoplay" allowfullscreen></iframe>

ThinkRail uses `git worktree` functionality to create and manage these isolated environments. You can read more about 
git worktrees [here](https://git-scm.com/docs/git-worktree).

## Work safely on many tasks at the same time

On top of that, while one AI agent works on a complex task, you can create another workspace from the same branch 
and assign a different task to a second AI agent. For instance, one agent can implement a change that does not modify 
the app’s behavior while another updates project specifications; these two tasks do not interfere with each other. 
Since workspaces are isolated, there is no need to wait for one task to complete before starting the other. Instead, 
you can run them concurrently and save time.

Once all tasks are complete, you can merge the changes back to the parent branch. If your workspaces originated from
the main branch, you can now tell the AI agent to create a pull request (there is a skill for that). If they branched
from a feature branch instead, you can instruct the AI agent to push the changes to that branch or simply do it yourself
from the terminal.

<iframe src="https://www.youtube.com/embed/rJDV4qrLZlo" width="640" height="360" allow="autoplay" allowfullscreen></iframe>

That is all for now. To try out ThinkRail, visit [our main webpage](https://thinkrail.ai) and follow the installation 
instructions. You can also browse [our GitHub repository](https://github.com/JetBrains/thinkrail), 
take [our survey](https://forms.gle/es1ksqAax6hnDWCP8), and join [our Discord server](https://discord.gg/Wybu9ceWkY) 
to say "hi!" and let us know what you think. Your feedback is greatly appreciated.

Happy developing!

------



*ThinkRail is backed by JetBrains, leveraging their expertise in building developer tools that are both powerful and intuitive.*
