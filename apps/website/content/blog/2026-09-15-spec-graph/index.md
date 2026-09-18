---
title: ThinkRail Spec-Driven Development
slug: thinkrail-sdd
date: 2026-09-15
author: maciej-gorywoda
excerpt: The specs work as guardrails for your AI agent - always present so that the agent will not go off-course
tags:
  - thinkrail
  - spec-driven development
---
# Spec-Driven Development

## A lesson in history

Life has a funny way of sneaking up on you.

When I graduated from university, one of the main good programming practices common at that ancient time was that 
we should write good, clear documentation. It was an era of early Java and the already convoluted C++. The Internet 
existed, but was not very useful. If I wanted to learn how some undocumented code worked, I could try to download 
the sources of whatever libraries it used, try to read them, and then copy-paste them into a separate small project, 
provide some mock data, and run it. It was tedious. Documentation saved time.

In fact, already in 2004, as a sort of follow-up on the Agile Manifesto and the Test-Driven Development concept, 
[Jonathan Ostroff, Richard Paige, and David Makalsky](https://specdriven.com/people#ostroff-paige-makalsky) published 
*Agile Specification-Driven Development*; and later Paige and Ostroff also published *Specification-Driven Design with 
Eiffel and Agents for Teaching Lightweight Formal Methods*.

But soon, with better internet resources, IDEs, Stack Overflow, and programming forums, came the idea that it is enough 
for the code to be readable. And sure, it is very important for the code to be readable (or at least so I believe), 
but at some point many software developers decided that documentation is redundant. After all, we now had advanced tools 
that helped us read, understand, and modify the code, while updating documentation was tedious; and if we leave 
documentation unupdated, it can become confusing and cause bugs.

Writing documentation was pushed to the edges of the software development pipeline. It still made sense to do some 
planning at the beginning, and to write documentation for users when the library or app was almost ready, but 
the majority of software developers stopped doing it while they worked.

And then AI coding agents appeared, and it all turned 180 degrees once more. Documentation is back, because it helps 
the agents stay on course. Is it not ironic? Generating code from ad-hoc prompts is messy. Even the best state-of-the-art 
Large Language Model will not help if you do not really know what you are doing. And, let us be honest, when we work on 
a big project, it is impossible to keep every little detail in our heads; and just as before it was difficult to write 
good code manually, now it is still difficult to write prompts that result in good code.

Instead, take some time to plan out and write down what your project is about. In short, Spec-Driven Development (SDD) 
is exactly that: it is the practice of writing an explicit, structured specification first and treating it as the source 
of truth from which an AI coding agent generates, and against which it validates, the implementation. It replaces ad-hoc 
vibe coding with a disciplined plan-implement-verify loop, preserving intent and context across agent sessions. In a way, 
the generated source code becomes just an implementation detail, even if you are still welcome to review it and modify 
it manually.


## Spec-Driven Development in ThinkRail

You may start simply with adding a new section to `AGENTS.md` in the main folder of your project. This way you tell 
AI agents that the project uses SDD and where they can find relevant specifications for their work. It might be 
something like this:

> This project is **spec-driven**: the specs are maintained alongside the code and are the source of truth; the code can 
> be both generated or hand-written, but must be and checked against them. Specs are never generated from code.
>
> **Read the specs before the code.** Start at `goal-and-requirements.md` (the goal and scope) and
> `architecture.md` (topology, boundaries, invariants), then the nearest `SPEC.md`.
>
> - A `SPEC.md` sits **beside the code it describes** and covers one genuine module. A module might mean a subfolder, 
> but also many subfolders may belong to one module and share only one `SPEC.md`
> - A `SPEC.md` states intent: what a module is for, what it owns, what is it for, and why the non-obvious decisions 
> were made.
> - If the work in the project results in a code change that is against what is described in `SPEC.md`, confirm 
> it should be done, and if yes, make both the code change and update `SPEC.md`. Never diverge silently.
>
> Every spec begins with a YAML header. `id`, `type` and `title` are required; the rest are used only where they carry 
> real information:
>
> ```yaml
> ---
> id:   # a unique id, this is how other specs reference this one
> type: # goal-and-requirements | architecture-design | module-design | submodule-design | task-spec
> title: # full title
> status: # draft | active | stale | done | deprecated
> parent: # the id of the spec directly above it in scope
> depends-on: # the ids of other SPEC.md files important to this one
> tags: # tags describing the contents
> ---

The header states that there are already a few other Markdown documents in the main folder: `goal-and-requirements.md` 
and `architecture.md`, which describe the project in general, and then `SPEC.md` in the main code subfolder. Divide 
the knowledge about the project among them however you like, or give some guidelines to the agent and let it create them, 
and then edit them to your liking.

You may also notice that there is a standardized way the spec documents reference each other by identifiers. Together, 
they form a spec graph. Organizing documents this way means that the AI agent does not need to read too much at once. 
It can access only the most relevant `SPEC.md` (i.e., the one closest to the code it works on) and search for others 
only if needed. The context does not grow too big. Important information does not get lost in the crowd. In a way, 
the specs work as guardrails for your AI agent: always present so that the agent will not go off-course but 
not getting in the way if everything works well.

To read those documents, look to the right panel in ThinkRail. There you will find the Specs tab. When you open it, 
you will see the titles of all specs in the project, already organized in a foldable tree. By unfolding it, you gain 
access to specs from submodules, and by clicking on them, you open them in read-only mode in the central panel. 
In the following video you can see how the spec graph looks like in [the ThinkRail project itself](https://github.com/JetBrains/thinkrail):

<iframe src="https://youtube.com/embed/603EdnbbDYo" width="640" height="360" allow="autoplay" allowfullscreen></iframe>

And that is it for today. To learn more about Spec-Driven Development used for working with AI coding agents, 
I invite you to read ["Spec-Driven Development: From Code to Contract in the Age of AI Coding Assistants"](https://arxiv.org/html/2602.00180v1) by Deepak Babu Piskala, 
a comprehensive introduction to the modern version of SDD. And of course, please try it out in ThinkRail, working on 
your project, and let us know: what do you work on? Has SDD helped you? Or have you decided it is not a good approach?

To try out ThinkRail, visit [our main webpage](https://thinkrail.ai) and follow the installation
instructions. You can also browse [our GitHub repository](https://github.com/JetBrains/thinkrail),
take [our survey](https://forms.gle/es1ksqAax6hnDWCP8), and join [our Discord server](https://discord.gg/Wybu9ceWkY)
to say "hi!" and let us know what you think. Your feedback is greatly appreciated.

Happy developing!