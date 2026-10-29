---
title: "GUI overview"
slug: gui-overview
date: 2026-10-28
author: maciej-gorywoda
excerpt: "A guided tour of ThinkRail's interface: the chat, the workspace panels around it, and the settings, one screenshot each."
draft: false
tags:
  - gui
  - overview
---

This blog post is going to be a bit different from the others. We will take a quick walk through ThinkRail's
Graphical User Interface. Below, you will find ThinkRail's graphical components, grouped into the chat, the workspace
around it, and the settings. For each component, there is a screenshot with the most important visual elements
highlighted, plus a one-sentence description of the component's purpose. Click a screenshot to see it in full size.
In addition, if we have already published a separate blog post about the given feature, there is a link to it.

Please note that ThinkRail is still in development. This blog post discusses features and their visual elements
as they appear in version 0.3.0 (Nightly) on October 27, 2026. If you are reading this a few months later,
your experience may differ.

## The chat

|  |  |
|---|---|
| The chat tab where you talk with the AI agent. A turn that changed files ends with a summary and a **Review turn** button ([ThinkRail 0.2.0](/blog/thinkrail-0-2-0-review-the-turn/)). | [![Chat tab with a finished turn and the message box](./images/01_chat_window_tab.png)](./images/01_chat_window_tab.png) |

|  |  |
|---|---|
| [![A file opened in a tab next to the chat](./images/02_chat_window_code_highlight.png)](./images/02_chat_window_code_highlight.png) | A read-only file tab in the same window, where you can read the code your agent wrote. |

|  |  |
|---|---|
| The chat history popup, where you can reopen, rename, or delete previous conversations. | [![Chat history popup listing recently closed chats](./images/03_view_chat_history_popup.png)](./images/03_view_chat_history_popup.png) |

|  |  |
|---|---|
| [![The New terminal in this group button](./images/04_new_terminal_in_this_group.png)](./images/04_new_terminal_in_this_group.png) | A button that opens a new terminal as a tab next to your chats. |

|  |  |
|---|---|
| Token usage of the current chat: input, output, cache reads and writes, cost, and how full the context window is. | [![Token usage bar above the chat](./images/05_token_usage.png)](./images/05_token_usage.png) |

|  |  |
|---|---|
| [![Resources popup with background work and MCP servers](./images/06_resources.png)](./images/06_resources.png) | The Resources popup, where you can follow the background commands and subagents your agent started, and the MCP servers the chat uses. |

|  |  |
|---|---|
| The Skills popup, where you can switch skills on and off for the chat and reload them when they change on disk ([An agentic IDE that follows Pi's philosophy](/blog/thinkrail-pi-skills-and-desktop-apps/)). | [![Skills popup with a switch for each skill](./images/07_skills.png)](./images/07_skills.png) |

|  |  |
|---|---|
| [![Model picker with recent models and the effort slider](./images/08_llms.png)](./images/08_llms.png) | The model picker, where you choose the LLM for the current chat and its reasoning effort. |

## The workspace

|  |  |
|---|---|
| The terminal panel, where you can type commands and work with your OS. | [![Terminal panel with a restored session](./images/09_pty.png)](./images/09_pty.png) |

|  |  |
|---|---|
| [![Projects panel with three projects and their workspaces](./images/10_projects.png)](./images/10_projects.png) | The Projects panel: your open projects, the workspaces in each, and the Settled shelf for finished ones ([ThinkRail Workspaces](/blog/thinkrail-workspaces/)). |

|  |  |
|---|---|
| The current project, workspace, and branch, and how the branch stands against its remote and pull request. | [![Top bar with project, workspace, branch, remote, and pull request](./images/11_current_project.png)](./images/11_current_project.png) |

|  |  |
|---|---|
| [![Specs panel showing the spec tree](./images/12_specs.png)](./images/12_specs.png) | The Specs panel, where you can browse all the specifications of the project ([ThinkRail Spec-Driven Development](/blog/thinkrail-sdd/)). |

|  |  |
|---|---|
| The Files panel, where you can browse and open the project's files, or show only the changed ones. | [![Files panel with the All and Changed views](./images/13_files.png)](./images/13_files.png) |

|  |  |
|---|---|
| [![Changes tab with a side-by-side diff and the changed files](./images/14_changes.png)](./images/14_changes.png) | The Changes panel, where you review what the agent changed in the last turn or on the whole branch ([ThinkRail 0.2.0](/blog/thinkrail-0-2-0-review-the-turn/)). |

|  |  |
|---|---|
| The Review panel, where you collect comments on lines of files and diffs and send them to the agent. | [![Review panel next to a diff](./images/15_review.png)](./images/15_review.png) |

|  |  |
|---|---|
| [![TODO List rail next to the plan of a chat](./images/16_todo.png)](./images/16_todo.png) | The TODO list, where you and your agent plan the next steps, with the full plan one click away ([ThinkRail 0.2.0](/blog/thinkrail-0-2-0-review-the-turn/)). |

## Settings

|  |  |
|---|---|
| Choose the default model for new chats and for reviews, and which models show up in the picker. | [![Settings, Models page](./images/17_settings_models.png)](./images/17_settings_models.png) |

|  |  |
|---|---|
| [![Settings, Providers page](./images/18_settings_providers.png)](./images/18_settings_providers.png) | Connect your LLM providers, with a subscription or an API key. |

|  |  |
|---|---|
| Add MCP servers from presets or your own configuration; ThinkRail asks in the chat before calls that may change data ([ThinkRail 0.2.0](/blog/thinkrail-0-2-0-review-the-turn/)). | [![Settings, MCP servers page](./images/19_mcp_servers.png)](./images/19_mcp_servers.png) |

|  |  |
|---|---|
| [![Settings, Prompt templates page](./images/20_prompt_templates.png)](./images/20_prompt_templates.png) | Create templates for your most frequently used prompts, for one project or for all of them. |

|  |  |
|---|---|
| Choose the pi config folder ThinkRail uses, and set environment variables for the agent, terminals, and MCP servers. | [![Settings, Environment page](./images/21_environment.png)](./images/21_environment.png) |

|  |  |
|---|---|
| [![Settings, Chat page](./images/22_chat.png)](./images/22_chat.png) | Tune the chat: message order, message box size, line width, how the view follows a streaming answer, and how many subagents a chat may run. |

|  |  |
|---|---|
| Pick a theme and contrast level, and the line width for files and diffs. | [![Settings, Appearance page](./images/23_appearance.png)](./images/23_appearance.png) |

|  |  |
|---|---|
| [![Settings, Language page](./images/24_language.png)](./images/24_language.png) | Change the interface language, or add your own translation. |

|  |  |
|---|---|
| Switch between layout presets (Balanced, Focus, Review) or save your own panel arrangement. | [![Settings, Layout page](./images/25_layout.png)](./images/25_layout.png) |

|  |  |
|---|---|
| [![Settings, Terminal page](./images/26_terminal.png)](./images/26_terminal.png) | Choose how much terminal output to restore when you come back to a terminal. |

|  |  |
|---|---|
| Set the time after which an idle workspace moves to the Settled shelf. | [![Settings, Workspaces page](./images/27_settings_workspaces.png)](./images/27_settings_workspaces.png) |

|  |  |
|---|---|
| [![Settings, Integrations page](./images/28_integrations.png)](./images/28_integrations.png) | Check that the GitHub CLI is signed in, so you can create workspaces from remote branches. |

|  |  |
|---|---|
| Switch ThinkRail's extensions on or off, such as Visualize, which lets the agent draw diagrams, comparisons, and mockups in the chat. | [![Settings, Extensions page](./images/29_extensions.png)](./images/29_extensions.png) |

|  |  |
|---|---|
| [![Settings, Notifications page](./images/30_notifications.png)](./images/30_notifications.png) | Get notified when a workspace needs your attention. |

|  |  |
|---|---|
| Decide whether you want to share additional anonymous usage data with us. | [![Settings, Privacy page](./images/31_privacy.png)](./images/31_privacy.png) |

|  |  |
|---|---|
| [![Settings, Feedback page](./images/32_feedback.png)](./images/32_feedback.png) | Schedule an interview, or join our Discord server, and share your thoughts with us. |

## Not pictured here

Some features don't fit in a single screenshot: the agent asking you multiple-choice questions in the chat instead of
guessing, and drawing diagrams, option comparisons, and before/after mockups right in the conversation; the
**Cmd/Ctrl+K** switcher that takes you to the chat waiting for you; the approval prompt on MCP calls that may change
data; the full Plan page, where each finished step shows its summary and verification; and the top bar actions that
publish your branch, open a pull request, and show its CI checks. The
[ThinkRail 0.2.0 post](/blog/thinkrail-0-2-0-review-the-turn/) covers several of them.

## Try out ThinkRail

Grab the desktop app below, or see the rest of what ThinkRail does on [**our main webpage**](https://thinkrail.ai/?utm_source=blog&utm_medium=organic-social&utm_campaign=gui-overview).

Find us on social media platforms: [**X/Twitter**](https://x.com/ThinkRailAI), [**YouTube**](https://www.youtube.com/@ThinkRailAI), and [**TikTok**](https://www.tiktok.com/@thinkrail).
You can also browse [**our GitHub repository**](https://github.com/JetBrains/thinkrail),
take [**our survey**](https://forms.gle/es1ksqAax6hnDWCP8), and join [**our Discord server**](https://thinkrail.ai/discord)
to say "hi!" and let us know what you think. Your feedback is greatly appreciated.

Happy developing!

------



*ThinkRail is backed by JetBrains, leveraging their expertise in building developer tools that are both powerful and intuitive.*
