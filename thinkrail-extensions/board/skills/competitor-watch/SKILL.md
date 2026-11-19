---
name: competitor-watch
description: "Use when the user asks what changed at the competitors on the ThinkRail board's watchlist, or to refresh one competitor's snapshot; a `/skill:competitor-watch` kickoff from the watchlist's What changed? included."
---

# Checking the competitor watchlist

Refresh each watched competitor, write one dated report, store each entry's new snapshot and tell the
human what changed since the last one. It runs on request only.

## Steps

1. **Read the watchlist.** `board_watchlist_get` (with `watchId` for one entry): names, URLs, notes and
   the last snapshot's text and date.
2. **Refresh.** `fetch_content` the entry's URLs (several in one call), then `web_search` for its
   recent releases, pricing changes and what users say; `get_search_content` reads a result in full.
3. **Write the report** into this workspace's artifacts folder, `.thinkrail/context/`, dated as the
   kickoff says (`competitor-watch-<date>.md`): per competitor, what it offers now, pricing, recent
   changes and user signals, every claim with its URL.
4. **Snapshot each entry.** `board_watchlist_snapshot { watchId, text, artifactPath }`: `text` is plain,
   stable lines — one fact per line, the same headings each time (Features, Pricing, Releases,
   Signals) — so the next diff shows only real change. It returns the previous snapshot.
5. **Say what changed**, entry by entry, against the previous snapshot: new, changed, gone. With no
   previous snapshot, say this one is the baseline.
6. **Offer, don't file.** A gap worth pursuing is offered as an idea; file it with `board_idea_create`
   only once the user agrees.

## Red flags

- A snapshot that rewords unchanged facts, so the diff is noise.
- Claiming a change the sources do not show, or a URL you could not fetch read as "no change".
- Editing ideas, initiatives or cards unasked.
