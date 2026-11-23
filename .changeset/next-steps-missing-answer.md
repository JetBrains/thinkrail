---
"@thinkrail/pi-next-steps": patch
---

`suggest_next_steps` no longer ends a turn whose message has no text answer. When a model writes its
final answer only as thinking and then calls the tool, the call is refused once with a request to write
the answer as a normal reply; the refused result (`details.refused: true`, no suggestions) shows no
chips, and a second call in the same turn is accepted.
