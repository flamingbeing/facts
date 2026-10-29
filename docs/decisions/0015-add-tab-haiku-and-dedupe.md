# 0015: The Add tab on Haiku, one box, and a dedupe pass

Status: accepted (2026-10-30). Replaces the Add tab's one-fact and Paste notes modes and their two routes; "Draft on a topic"
(/api/draft) stays as a toggle on the same box and model, its drafts checked for duplicates only.

Decision: the Add tab has one box and one route, `/api/file`. It runs on Claude Haiku (`claude-haiku-5-5`, effort low)
by default; a small toggle picks Sonnet (`claude-sonnet-5-5`), remembered per device. The page sends `model: 'haiku' |
'sonnet'` and the Worker maps it, so the page never names a model id. The route makes two passes: split and file (the
topic list in a cached system block), then reconcile each touched topic's existing lines with the new facts, giving each
fact one action (new, duplicate, merge, correct). Duplicates are set aside; merge and correct need his tap and are queued
as `edit` items carrying the old line and why. Every line keeps his numbers; a merge or correct that loses or invents a
number falls back to new. Every call stays under 100k input tokens (a big topic is reconciled in chunks).

Why: filing is short, rule-bound work where Haiku is good enough at a fraction of Sonnet's price, and the topic list is the
same on every call, so caching it makes repeat adds cheap. Most pasted notes partly repeat what is already there; checking
against the topic's lines turns those into "already there" or a proposed edit instead of near-duplicate lines.

What follows: the queue has a new item shape (`edit:` facts with `old` and `why`), which the notes' processor applies or
holds if the line changed since. Measured cost per fact is in NOTES.md, "Add tab cost".
