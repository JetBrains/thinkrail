---
title: An agentic IDE that follows Pi's philosophy
slug: thinkrail-pi-skills-and-desktop-apps
date: 2026-10-01
author: maciej-gorywoda
excerpt: ThinkRail is on purpose a thin layer on top of Pi; nothing about how the agent thinks, what it is allowed to do, or how it manages context is ThinkRail's to reinvent.
tags:
  - thinkrail
  - Pi
  - skills
  - desktop
---

## ThinkRail - Pi compatibility

ThinkRail comes with its own Pi coding agent, embedded as a library. Pi runs inside ThinkRail's own process. 
If you have Pi installed separately, both share Pi's hidden folder, `~/.pi`. This allows ThinkRail to access 
Pi's configuration and extensions. For example, ThinkRail gains access to Pi's list of providers and models, 
and to the chats' history. If until now you have worked in Pi's native CLI, you can switch to ThinkRail without 
losing any of your work. (The same goes the other way: you can run a session in ThinkRail and later switch 
to the Pi CLI, if you want.)

ThinkRail is on purpose a thin layer on top of Pi; nothing about how the agent thinks, what it is allowed to do, 
or how it manages context is ThinkRail's to reinvent. That is Pi's job, and always will be. ThinkRail's job, in turn, 
is to add a simple, readable GUI and just a handful of well-designed features that we believe to be valuable, 
all without compromising Pi's philosophy.

Similarly, Pi's skills and extensions are automatically recognized and usable from ThinkRail. There are, however, 
a few caveats:

1. ThinkRail will run a given skill or extension on its own embedded Pi, which might be different from your native Pi installation. In some cases, this may lead to the skill or extension not working correctly.
2. Extensions that alter Pi's visual interface do not work in ThinkRail. For example, Pi themes are meant for Pi's terminal UI, while ThinkRail uses its own theme system. However, extensions that add engine-side behavior (such as tools, event hooks, slash commands, and even simple dialogs) should work in ThinkRail.
3. ThinkRail comes with a number of bundled extensions: `pi-web-access`, `pi-visualize`, `pi-spec-graph`, `pi-thinkrail-workflow`, `pi-todos`, and a few others. On top of that, it looks for other skills in folders such as `.claude/` and `.gemini/`, if you have them. If two extensions register the same tool name, Pi keeps both loaded, reports a conflict, and the load order decides which one is used.


## The Skills window

Some skills are project-dependent. ThinkRail discovers them in the `~/.pi`, `~/.claude`, `~/.codex`, `~/.copilot`, and 
`~/.gemini`, but also - in the case of Pi, Claude, and Gemini - in their counterparts in the specific project you are working on. 
Therefore, when you open ThinkRail, you first need to choose your project, and the workspace within it, because the list 
of the project's skills may differ depending on the workspace. Then, click the "Skills" button in the top-right corner 
of the main view. When you click it, you will see a window with a list of available skills. The list is divided 
into two parts: first, a list of skills bundled with ThinkRail (some of which I mentioned in the previous chapter), 
and then skills coming from Pi, other AI agents, and those defined in the project.

<iframe src="https://youtube.com/embed/uaaG8q8bFQ0" width="640" height="360" allow="autoplay" allowfullscreen></iframe>

For the same reason, if you switch to the current project from another one, the list of skills may change. 
Also, ThinkRail may detect that changes were made to the skill descriptions in the folders it is monitoring. 
In both cases, you will see a "Skills changes on disk" popup and a "Reload" button that you can use to refresh the list.


## Desktop apps

The minimalist approach to software development pays off in many ways. One of them is that we were able to ship native 
desktop apps with relative ease. They are packaged with Electrobun, and otherwise they run identically to 
the CLI `thinkrail` app that opens in your browser. The difference is purely a matter of how you like to work: 
are you a person who prefers a desktop icon you can click and a distinct window for your ThinkRail app? 
Or is the terminal the first thing you open after starting your laptop, so that you would rather start ThinkRail 
by typing a command? In any case, before you make the decision, try out the desktop app. 
Go to [our main webpage](https://jb.gg/osk2n7) and choose an installation package for your operating system: macOS, Windows, or Linux (Ubuntu).

By the way, you can also browse [our GitHub repository](https://github.com/JetBrains/thinkrail),
take [our survey](https://forms.gle/es1ksqAax6hnDWCP8), and join [our Discord server](https://discord.gg/Wybu9ceWkY)
to say "hi!" and let us know what you think. Your feedback is greatly appreciated.

Happy developing!

------



*ThinkRail is backed by JetBrains, leveraging their expertise in building developer tools that are both powerful 
and intuitive.*
