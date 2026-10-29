# Status

## Now

- **Add tab follow-ups** (29 Oct, SGT; PR "Facts: Add tab model button and topic drafts"): a Sonnet/Haiku button (sent as `model` to all three routes); **Draft on a topic** (`/api/draft`, worker/draft.js): the model writes up to 20 lines, shown as cards marked model-drafted, no Confirm all, each Confirm queues an `add` with `q: 'model-drafted'`; paste limits raised to 30000 characters, 150 lines, `max_tokens` 32000. Nothing needed from the owner; the processor (private repo) can read `q` when it wants to treat drafts differently.
- **Add tab, Paste notes** (29 Oct, SGT; PR "Facts: Add tab paste-notes mode"): a toggle for a big box (30000 characters now); `/api/file-many` (worker/file-many.js) splits the dump into up to 150 one-line facts, each checked against his numbers, shown as a stack of confirm cards (Confirm / Discard each, Confirm all / Discard all). Each Confirm is an `add` item as before. Needs the same `ANTHROPIC_API_KEY` secret; one call can take a minute or so for a long paste.
- **Log tab** (29 Oct, SGT; PR "Facts: Log tab"): after Add, before Settings. His answers newest first (filter Changes only / All); for the owner, the notes' queue from the owner-only `GET /api/queue` (last 14 days, each queued / done + PR link or note / held + why). Last step of the anaesfacts app plan.
- **Test tab** (29 Oct, SGT; PR "Facts: Test tab"): quiz over every line with a question, FSRS-style spacing (`schedule.js`), per-topic score, per-user recall docs, owner-only "This fact is wrong" (queue item `flag`) that sends a line back to Align. Log tab is next; it can reuse `ask.js`, `cards.js` and `app.verdict/flush`.
- **Add tab** (29 Oct, SGT; owner only, after Align): he types a fact, `/api/file` (worker/file.js, Claude Sonnet) files it, a confirm card (topic, section, line, all editable) -> Confirm saves a verdict `add` (`add:<area>/<slug>#<time>`, text, section) and flushes it to the queue; Discard clears. The Worker needs the secret `ANTHROPIC_API_KEY` (until then the route says "not set up"). Test and Log tabs come next and reuse `app.verdict/flush/file` (cloud.js), the `loadData` topic list, and the tab markup pattern (tab + side link + `.ui-tab-page`).
- Items tab removed (29 Oct, 17:15 SGT): Align is the first tab and holds the sign-in, no-access and not-set-up gates and the sync chip; Settings keeps sign-out. The sample list, its sheet and its tests are gone; e2e saves use Align's seen verdict.
- Filled (29 Oct): look E, Violet. **Align** tab: cards from the notes, answers saved as verdicts, area chips and
  find, fix sheet, jank gate (PR #4).

- Sample app is on app-ui 1.0.0-rc.13's kit shell and `settingsScreen` (2026-10-28).
- Startup and shared fixes (2026-10-28): no sign-in flash, last list painted at once, modulepreload, no pinch zoom, PNG icons and theme colours, list sort remembered per device, `createdAt` shown and sortable.

## Waiting on the owner

- <nothing>

## Next

- Live smoke with test-bot after deploy (needs the OAuth redirect URI and JS origin on the Web client).
- Flag cards: an owner-only Worker route (with the next step's token).

## Decisions (dated)

- <date>: <decision>
