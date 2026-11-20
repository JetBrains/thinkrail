---
name: discovery-research
description: "Use when the user wants an idea on the ThinkRail board researched on the web — competitors, how they solve it, pricing, reviews, user signals — into a cited report attached as evidence; a `/skill:discovery-research` kickoff from the idea's Research included. Not for scoring an idea (discovery-analyze)."
---

# Researching a discovery idea

Find out who else solves the idea's problem and what users say, write it up with a source for every
claim, and attach the report and its key sources to the idea. Research; never score or shape.

## Steps

1. **Read the idea.** `board_ideas_list { ideaId }`: its pitch and the evidence already attached — do
   not repeat a source it has.
2. **Search.** `web_search` with a few angles in one turn: the problem in users' words, the obvious
   competitors, "alternatives to …", reviews and complaints. `get_search_content` reads a result in full.
3. **Read the sources worth it** with `fetch_content` (several URLs in one call): product pages,
   pricing, changelogs, docs, review threads. A page that fails to fetch is reported, not guessed.
4. **Write the report** into this workspace's artifacts folder, `.thinkrail/context/`, named as the
   kickoff says (`research-<id>-<date>.md`): the question; a competitor table (what it does, how,
   price, strengths, gaps); what users ask for; open questions. Every claim ends with its URL; a
   quote is marked as one.
5. **Attach it.** `board_idea_add_evidence { ideaId, kind: "artifact", ref: the report's path, quote:
   the main finding in one line }`, then the two to five sources that matter most with `kind: "url"`
   and the quote each backs.
6. **Hand off.** Summarize the findings in a few lines and point at the report; the analysis
   (`discovery-analyze`) scores the idea.

## Red flags

- A claim without a source, or a quote a page does not contain.
- Writing the report anywhere but `.thinkrail/context/` of this workspace.
- Scoring the idea, or filing initiatives and cards — not this skill's job.
- Marketing copy taken as fact; say when only the vendor claims it.
