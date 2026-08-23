# Jay Yang × BIPU — 6Ps Copy Eval

Local-first landing page for `jay.buildinpublicuniversity.com`.

The page lets a visitor paste writing, sends it to a Cloudflare Worker endpoint, and returns:

- a 0–12 6Ps score;
- PASS / REVISE / STOP;
- exactly three prioritized recommendations;
- a direct handoff to Jay Yang's book presale.

The evaluator does not store submitted writing. The OpenRouter key is a Worker secret, never a browser variable.

## Configuration before deployment

The exact presale URL is configured as:

`https://www.kickstarter.com/projects/jayyanginspires/work-with-the-best`

The attribution source is the supplied Jay Yang X post:

`https://x.com/Jayyanginspires/status/2090589801074315339?s=20`

The X post was inaccessible to the available extractor, so the page uses a verified source-credit link rather than claiming to embed an unverified screenshot asset. If you supply a local screenshot file, it can be added to `public/assets/` and linked from the source-credit card.

Set the provider secret through Wrangler's secret flow:

```bash
npx wrangler secret put OPENROUTER_API_KEY
```

The model is pinned to the verified OpenRouter slug:

```text
deepseek/deepseek-v4-flash
```

## Rubric provenance

The scoring guidance is grounded in Jay Yang's longer essay, archived at
`docs/jay-yang-copywriting-article.md`.
Each P now carries falsifiable sub-checks from that source:

- People → Empathy Map; "the pain is the pitch"
- Positioning → the Schlitz test (first to tell a convincing fact)
- Promise → the repeated "so what?" test; outcome over feature
- Proof → three proof types; the deaf-and-mute "can you point at it" test
- Priority → scarcity / urgency / cost of inaction
- Process → the belief-flip ("Everyone thinks X. The problem is Y. So the solution is Z.")

The 5Cs writing layer (Clear, Concise, Concrete, Conversational, Cadence),
the hook formula (Benefit × Relevance × Credibility / Perceived Effort), and
CTA completeness (who/what/when/how) are reported as advisory notes only.
The release gate is unchanged: every P ≥ 1, People/Promise/Proof = 2,
total ≥ 9/12.

## Analytics and notifications

Fathom is configured as a dedicated private property:

```text
site: Jay Yang 6Ps Copy Eval
site ID: AELNXPSE
```

The production page includes the Fathom script and aggregate events:

- automatic pageviews;
- `copy_eval_started`;
- `copy_eval_completed`;
- `presale_clicked`.

No writing, email address, transcript, or identifying payload is sent to Fathom.

The Worker also maintains a per-path Durable Object counter for operational alerts. Subjects are intentionally readable:

- `Jay BIPU traffic: / reached 10 edge page visits`
- `Jay BIPU grader alert: OpenRouter unavailable (HTTP 402)`

Thresholds are 10-visit steps through 100, 100-visit steps through 1,000, then 1,000-visit steps thereafter. The edge counter is not a unique-visitor count; Fathom is the analytics source for visits and events. OpenRouter failure alerts are throttled to one per hour.

Resend sends from `alerts@buildinpublicuniversity.com`; the API key is stored as the Worker secret `BIPU_RESEND_API_KEY`. The alert recipient is configured in `wrangler.jsonc`.

## Local checks

```bash
node --check src/index.js
node --check public/app.js
python3 -m http.server 8787 --directory public
curl -sS http://127.0.0.1:8787/ | grep -E '<title>|6Ps|presale'
```

The static page will load locally. `/api/grade` requires the Worker runtime and an API key; without those, a local static server correctly has no API endpoint rather than faking a grade.

## Deployment receipts

The custom domain is live and verified. Current production receipts include:

1. Worker/Assets deployment;
2. `OPENROUTER_API_KEY` secret configured;
3. `BIPU_RESEND_API_KEY` secret configured;
4. `/api/health` readback;
5. real non-sensitive smoke grade readback;
6. custom-domain binding and DNS;
7. HTTPS/content/API readback;
8. Fathom script/site marker readback;
9. Resend setup-test acceptance receipt.
