# Content Idea Tournament

Pain-first bracket for content ideas, structured through Jay Yang's 6Ps of
CopyTHINKING and judged by agent archetypes with different attentiveness levels
and problem shapes.

## Files

- `pods.json` — pod definitions (idea pools by pain theme), judge archetypes, format rules.
- `tournament.py` — the bracket runner.
- `tournament_report.json` — full receipt of a run: every matchup, every judge verdict with scores, champions.
- `docs/jay-yang-copywriting-article.md` — rubric provenance (`../docs/`).

## How it works

1. **Pods** group ideas by pain theme (Time Poverty, The Plateau, Building
   Invisibly, The Trust Deficit, Someday Is A Plan).
2. **Round 1**: single elimination inside each pod, pairwise matchups.
3. **Finals**: pod champions meet in a cross-pod round-robin; most points wins.
4. **Judging**: every matchup is scored by all five archetypes:
   - The Skimmer (low attentiveness, hook only)
   - The Busy Operator (medium, pain match)
   - The Skeptical Buyer (high, proof stress)
   - The Pattern Hunter (high, belief-flip structure)
   - The Tired Scroller (low, clarity gate)
5. **Scoring axes** per judge: `pain_recognition` (0-5), `specificity` (0-5),
   `action_pull` (0-3).
6. **Pain gate**: pain recognition is double-weighted AND gating — an idea that
   loses or ties on pain recognition cannot win the matchup regardless of other
   axes. This enforces the thesis: demonstrate the reader's pain precisely;
   that's what sells the solution.

## Running

```bash
python3 tournament.py pods.json --out tournament_report.json          # live LLM judges (~$0.01/run)
python3 tournament.py pods.json --out dry_report.json --dry-run       # free bracket shape check
```

Requires `OPENROUTER_API_KEY` in env or `~/.hermes/.env`. Model pinned to
`deepseek/deepseek-v4-flash`, same rail as the live grader.

## Verified results — run 1 (2026-08-23)

Grand champion: **pod_time_pain** (4/4 final points)

> "You don't have a time problem, you have a key-man problem: everything routes
> to you because you never built a process that survives your absence."

Points: Time Poverty 4, Plateau 3, Urgency 2, Invisible 1, Trust 0.

Integrity: 5 pods, 10 pod matches, 10 final matchups, all 50 judge verdicts
returned complete scored JSON. Report at `tournament_report.json`.

## Feeding winners back into the grader

Champion ideas are pre-validated pain-first hooks. Two integration paths:

1. Use a champion as the opening line of new copy, then run it through the
   live grader at jay.buildinpublicuniversity.com to confirm the 6Ps gate still
   passes with the rest of the piece attached.
2. Add new ideas to `pods.json` and re-run; the report's per-judge verdicts show
   which archetype each idea persuades (or fails), so losing ideas can be
   diagnosed by *which judge* rejected them, not just that they lost.

## Cost note

Each matchup = 5 judge calls ≈ $0.0005–0.001 total per matchup at current
Deepseek pricing. A full 20-idea, 5-pod tournament costs well under $0.05.
