---
ticket_id: mt_bcd2f1da
kind: product_design
---
# Product design: Draft-on-type — defer blank-session save until the user types a prompt


## Goal

Make creating a blank session **free until it carries intent**. Clicking **+ New** (or `Cmd/Ctrl+T`, or the Command Palette) should open a ready-to-use session locally — without writing anything to the backend and without notifying other clients. The moment the user types a real prompt, that session becomes a first-class, autosaved draft: protected against reload, named after what the user is actually asking, and visible everywhere else.

This removes the steady accumulation of empty "Session N" drafts that nobody ever started, without sacrificing the safety of autosave or the convenience of the pre-Start configuration card.

- **In scope:** the blank new-session entry points — **+ New**, **Cmd/Ctrl+T**, and the Command Palette's "New session".
- **Out of scope (unchanged):** sessions that already carry intent at creation — meta-ticket sessions and approved **Suggested sessions** — which keep persisting immediately, exactly as they do today.

## User stories

- **Clutter-free start.** As a ThinkRail user, I want to click **+ New** and look around — or change my mind and leave — without creating a stored session, so that abandoned blank sessions never pile up in my sidebar or on disk.
- **Never lose typing.** As a ThinkRail user, once I start writing a prompt I want my text saved automatically, so that a reload, tab switch, or reconnect never loses what I was drafting.
- **Recognizable tabs.** As a ThinkRail user, I want a new draft named after what I'm actually asking, so that I can spot the right tab at a glance instead of staring at interchangeable "Session N" labels.
- **Configure then write, seamlessly.** As a ThinkRail user, I want to pick a skill / specs / model before typing and have those choices remembered, so that setting up and writing feel like one continuous action even though nothing has been saved yet.
- **No duplicate blanks.** As a ThinkRail user, when I press **+ New** again while I still have an untouched blank tab open, I want to land back on that tab, so that I don't accumulate duplicate empty sessions.
- **Short prompts still work.** As a ThinkRail user, I want to fire off a very short prompt by pressing Start/Send even if it's below the autosave threshold, so that the "save only when there's intent" rule never blocks me from actually starting.
- **Clean multi-client view.** As a ThinkRail user with more than one client open (a second browser tab, or mobile), I don't want other clients' half-started empty drafts showing up in my session list.

## User requirements

These describe observable behavior, not implementation.

1. **Lazy creation.** Opening a blank new session (**+ New**, **Cmd/Ctrl+T**, Command Palette "New session") must not create or persist anything on the backend and must not notify other clients. The session exists only in the current frontend until it is saved.
2. **Save trigger.** The session is created and saved only after the prompt contains **≥ 5 non-whitespace characters**. Saving is automatic and debounced — it fires shortly after typing pauses (~750 ms) — with a forced save during sustained typing (~5 s max wait) so long uninterrupted typing is still captured.
3. **Guaranteed capture on exit.** Any pending unsaved text must be flushed (saved) when the user blurs the input, switches tabs, reloads, or presses Start/Send — the user must never lose text by leaving.
4. **Start always works.** Pressing Start/Send saves and starts the session **regardless of the 5-character threshold** — a short prompt can still start a session.
5. **Restore on return.** Once saved, the typed prompt and the derived name are restored into the input box and the tab on reload or reconnect.
6. **Derived name.** Before any text is typed, the tab shows a neutral **"New session"** label. Once text exists, the name is derived from the prompt: trim leading/trailing whitespace and collapse internal runs of whitespace and newlines into single spaces, then show it as-is if **≤ 15 characters** or as the **first 14 characters + "…"** (label length ≤ 15 including the ellipsis) if longer. The name updates live as the user types.
7. **Manual rename wins.** If the user renames the session by hand, live name derivation stops permanently for that session.
8. **Cleared text after save.** If the user deletes the prompt back to empty (or below the threshold) **after** a draft was already saved, the draft is **kept** on disk but its tab label **reverts to "New session"** until text is typed again. If the name was not manually overridden, live derivation resumes when typing continues.
9. **Configure before typing.** The configuration card and the skill / spec / model / permission selectors work before any text is typed and hold the user's choices locally, with no backend calls. The prompt preview shows a **placeholder hint** until the session is saved, after which the live preview appears. Choosing configuration without typing persists nothing; those choices are applied when the draft is first saved.
10. **No duplicate blanks.** Triggering a new blank session while an untouched blank unsaved tab is already open must **focus that existing tab** instead of opening another.
11. **Scope guard.** Sessions that already carry intent at creation — meta-ticket sessions and approved Suggested sessions — continue to persist immediately and are unaffected.
12. **No migration.** Pre-existing empty "Session N" drafts on disk are left as-is; this behavior applies only to sessions created from now on.

## Product value

- **Less clutter, more signal.** The sessions sidebar and tab bar show only sessions the user actually engaged with, so the list stays short and meaningful instead of filling with abandoned blanks.
- **Clean backend and multi-client state.** No empty draft files accumulating on disk, and no spurious "session created" broadcasts pushed to other browser tabs, other clients, or mobile.
- **Safety preserved.** Autosave still protects in-progress prompts against reloads and disconnects — deferring the save changes *when* work is stored, never *whether* it's protected once it exists.
- **Recognizable at a glance.** Prompt-derived names replace interchangeable "Session N" labels, making the right tab easy to find.
- **No friction added.** Configuring and starting still feel instant. The threshold is low and Start always works, so in normal use the change is invisible — the user simply stops seeing junk drafts.

## Success criteria

- Clicking **+ New** and typing nothing produces **no** session file on disk and **no** "session created" broadcast to other clients.
- Typing **≥ 5 non-whitespace characters** then pausing creates **exactly one** draft; continued sustained typing saves **at most about once per max-wait window**.
- Choosing a skill or spec but typing no text persists **nothing**; once text crosses the threshold, the draft is created **carrying those earlier choices**.
- The derived name follows the cleanup + first-15 + "…" rule, **updates live** while typing, and **freezes after a manual rename**.
- Deleting all text after a draft was saved **reverts the tab to "New session"** while **keeping the draft** on disk.
- Reloading mid-draft **restores** the typed text and the derived name.
- **Start/Send** starts a session even with a sub-threshold prompt.
- A second new-blank trigger while an untouched blank tab is open **focuses that tab** instead of opening another.
- Meta-ticket sessions and approved Suggested sessions still **persist immediately** (no regression).

## Validation criteria

Each scenario is checked from the user's point of view (and is a candidate for an e2e test).

1. **Empty abandon.** + New → type nothing → switch away or reload. *Expect:* no file in `.tr/sessions/`; a second browser tab's session list shows no new entry.
2. **Threshold + debounce.** Type "fix" (3 chars) → nothing saved. Type "fix login" (≥ 5) and pause ~1 s → exactly one draft appears. Keep typing continuously for ~10 s → at most ~2 saves occur.
3. **Config-only, then type.** Open + New, pick a skill and a spec → confirm nothing is persisted. Then type ≥ 5 chars → the draft is created and carries the chosen skill + spec.
4. **Name derivation.** Type `Refactor   the` then a newline then `session store` → tab shows "Refactor the s…" (whitespace collapsed, first 14 + …). Keep editing → name tracks live. Rename by hand to "WIP" → further typing no longer changes the name.
5. **Clear after save.** Type enough to save, then select-all-delete → tab label reverts to "New session" and the draft is still present on disk. Type again → the name re-derives (since it wasn't manually renamed).
6. **Restore.** Type a multi-line prompt, wait for the save, reload the page → input box is repopulated with the text and the tab shows the derived name.
7. **Start below threshold.** Type "hi" and press Start/Send → the session starts normally.
8. **No duplicate blanks.** With one untouched blank tab open, press + New / Cmd-Ctrl+T → focus returns to the existing blank tab; no second blank tab opens.
9. **Flush on exit.** Type ≥ 5 chars and immediately — before the debounce elapses — press Start (or blur the input, or switch tabs) → the text is saved with no loss.
10. **Scope unaffected.** Create a meta-ticket session and approve a Suggested session → both still persist immediately, with their existing names (unchanged behavior).
