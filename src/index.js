const MODEL = "deepseek/deepseek-v4-flash";
const MAX_CHARS = 12000;
const SYSTEM = `You are a precise, constructive copy editor running the 6Ps of copyTHINKING eval.
The six dimensions are:
1. People: who is this for, specifically?
2. Positioning: why this over alternatives?
3. Promise: what changes for the reader?
4. Proof: why should the reader believe it?
5. Priority: why act now, if there is a real reason?
6. Process: what happens next and how does it work?

Sub-checks drawn from Jay Yang's longer article (docs/jay-yang-copywriting-article.md):
- People: does the writing show an Empathy Map (wins, frustrations, dreams, fears)? Does it describe the reader's problem better than they could ("the pain is the pitch")? Does it use the customer's own words?
- Positioning: is there a convincing fact or angle the writer is FIRST to tell (the Schlitz test)? Is positioning researched out (competitors), in (strengths), and forward (what customers value)?
- Promise: does it survive repeated "so what?" until it names a felt benefit? Outcome over feature ("1,000 songs in your pocket", not "5 gigabytes").
- Proof: which type is it — authority by association, own results, or client results? Apply the deaf-and-mute test: can you physically POINT at the evidence (a logo, a number, a receipt)? Vague claims like "trusted by industry leaders" score lower than pointable ones.
- Priority: is it scarcity, urgency, or cost of inaction — and is it real rather than invented? Pain of staying beats pleasure of moving.
- Process: is there a belief-flip structure ("Everyone thinks X. The problem is Y. So the solution is Z.") that explains why alternatives fail and creates a believable, easy-to-understand path?
Also note (report only, do not gate): 5Cs writing quality — Clear, Concise, Concrete, Conversational, Cadence; hook strength as Benefit x Relevance x Credibility / Perceived Effort; CTA completeness (who/what/when/how, one CTA per avatar per offer).

Grade only the supplied writing. Do not invent testimonials, results, deadlines, scarcity, statistics, citations, named customers, or facts. Recommendations must never introduce an unsupported number or claim, even as an example. When proof is missing, recommend adding a real receipt, case study, source, or observed result without fabricating one. When a draft needs a stronger promise, use a bounded placeholder such as [specific outcome] rather than making up a result.
Return ONLY valid JSON matching the requested schema. Recommendations must be concrete edits, not praise.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["overall_score", "decision", "scores", "recommendations", "summary"],
  properties: {
    overall_score: { type: "integer", minimum: 0, maximum: 12 },
    decision: { type: "string", enum: ["PASS", "REVISE", "STOP"] },
    scores: {
      type: "object", additionalProperties: false,
      required: ["people", "positioning", "promise", "proof", "priority", "process"],
      properties: Object.fromEntries(["people", "positioning", "promise", "proof", "priority", "process"].map(k => [k, {type:"integer", minimum:0, maximum:2}]))
    },
    recommendations: {
      type: "array", minItems: 3, maxItems: 3,
      items: { type: "object", additionalProperties: false, required: ["dimension", "problem", "fix"], properties: {
        dimension: {type:"string", enum:["People","Positioning","Promise","Proof","Priority","Process"]},
        problem: {type:"string", maxLength:400}, fix: {type:"string", maxLength:600}
      }}
    },
    summary: {type:"string", maxLength:600}
  }
};

function cors(origin) {
  const allowed = new Set(["https://jay.buildinpublicuniversity.com", "http://localhost:8787", "http://localhost:8788"]);
  return allowed.has(origin) ? origin : "https://jay.buildinpublicuniversity.com";
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {status, headers: {"content-type":"application/json; charset=utf-8", "access-control-allow-origin": cors(origin), "vary":"Origin", "cache-control":"no-store"}});
}
function gate(scores) {
  const ps = ["people","positioning","promise","proof","priority","process"];
  const total = ps.reduce((n, p) => n + Number(scores?.[p] ?? -99), 0);
  if (ps.some(p => ![0,1,2].includes(Number(scores?.[p])))) return "STOP";
  if (ps.some(p => Number(scores[p]) < 1) || ["people","promise","proof"].some(p => Number(scores[p]) !== 2)) return "REVISE";
  return total >= 9 ? "PASS" : "REVISE";
}
function sanitizeRecommendations(recommendations, scores) {
  const fallback = {
    People: "Name the specific reader, their situation, and the boundary that excludes everyone else.",
    Positioning: "Name the alternative the reader would otherwise choose and the concrete tradeoff that makes this offer different.",
    Promise: "State a bounded outcome using [specific outcome] rather than an unsupported guarantee.",
    Proof: "Add a real, traceable receipt that directly supports the promise; do not add a number until it is verified.",
    Priority: "Add a real deadline, capacity constraint, price change, or cost of delay; otherwise say the offer is evergreen.",
    Process: "Explain the first step, what happens next, and the effort or eligibility required."
  };
  const unsafe = /(?:\d|\b(?:for example|e\.g\.?|we|our|clients?|customers?)\b)/i;
  const contradiction = {
    people: /(?:no|missing|lacks|not specified|not defined).{0,45}(?:audience|reader|person|people)/i,
    positioning: /(?:no|missing|lacks|not specified).{0,45}(?:different|alternative|positioning)/i,
    promise: /(?:no|missing|lacks|not specified).{0,45}(?:promise|benefit|outcome|result)/i,
    proof: /(?:no|missing|lacks|not provided|absent).{0,45}(?:proof|evidence|receipt|support)/i,
    priority: /(?:no|missing|lacks|not specified).{0,45}(?:urgency|deadline|reason to act|priority)/i,
    process: /(?:no|missing|lacks|not specified).{0,45}(?:process|next step|how it works)/i
  };
  const result = recommendations.map((item, index) => {
    const dimension = fallback[item?.dimension] ? item.dimension : Object.keys(fallback)[index % 6];
    const text = `${item?.problem || ""} ${item?.fix || ""}`;
    const key = dimension.toLowerCase();
    if (unsafe.test(text)) item.fix = fallback[dimension];
    if (contradiction[key]?.test(text)) scores[key] = 0;
    return {dimension, problem: String(item?.problem || "Make this dimension more specific."), fix: String(item?.fix || fallback[dimension])};
  });
  return result.slice(0, 3);
}

async function grade(text, env) {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return {error:"grader_not_configured", message:"The grader is not connected yet. No writing was sent anywhere."};
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method:"POST",
    headers:{"authorization":`Bearer ${apiKey}`, "content-type":"application/json", "http-referer":"https://jay.buildinpublicuniversity.com", "x-title":"Jay Yang × Build in Public University — 6Ps Copy Eval"},
    body: JSON.stringify({model: env.OPENROUTER_MODEL || MODEL, temperature:0.2, max_tokens:4000, reasoning:{effort:"low"}, messages:[
      {role:"system", content:SYSTEM},
      {role:"user", content:`Grade this writing using the 6Ps. The release gate is: every P >= 1, People/Promise/Proof = 2, total >= 9/12. Return exactly three recommendations, prioritised by expected improvement.

Return a JSON object with exactly these top-level fields: overall_score (integer 0-12), decision (PASS, REVISE, or STOP), scores (object with integer fields people, positioning, promise, proof, priority, process, each 0-2), recommendations (array of exactly three objects with dimension, problem, and fix), and summary (string). Do not use flat score fields.

WRITING:
${text}`}
    ], response_format:{type:"json_object"}})
  });
  if (!response.ok) return {error:"provider_error", status:response.status, message:"The grader could not complete this run. Try again in a moment."};
  const payload = await response.json();
  const message = payload?.choices?.[0]?.message || {};
  const rawContent = message.content ?? message.reasoning ?? message.reasoning_details;
  if (!rawContent) return {error:"empty_provider_response", message:"The grader returned no usable result."};
  const raw = typeof rawContent === "string"
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map(part => typeof part === "string" ? part : (part?.text || "")).join("")
      : JSON.stringify(rawContent);
  let parsed;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try { parsed = JSON.parse(cleaned); }
    catch {
      const end = cleaned.lastIndexOf("}");
      if (end < 0) throw new Error("no JSON object");
      let parsedCandidate = null;
      for (let i = cleaned.lastIndexOf("{", end); i >= 0; i = cleaned.lastIndexOf("{", i - 1)) {
        try {
          const candidate = JSON.parse(cleaned.slice(i, end + 1));
          if (candidate && typeof candidate === "object" && candidate.scores && Array.isArray(candidate.recommendations)) {
            parsedCandidate = candidate;
            break;
          }
        } catch {}
      }
      if (!parsedCandidate) throw new Error("no JSON object");
      parsed = parsedCandidate;
    }
  } catch { return {error:"invalid_provider_json", message:"The grader returned an invalid result. Try again."}; }
  if (!parsed || typeof parsed !== "object" || !parsed.scores || !Array.isArray(parsed.recommendations) || parsed.recommendations.length < 3) {
    return {error:"invalid_provider_shape", message:"The grader returned an incomplete result. Try again."};
  }
  parsed.recommendations = sanitizeRecommendations(parsed.recommendations, parsed.scores);
  parsed.overall_score = Object.values(parsed.scores).reduce((sum, value) => sum + Number(value || 0), 0);
  parsed.decision = gate(parsed.scores);
  const weak = Object.entries(parsed.scores).filter(([, value]) => Number(value) < 2).map(([key]) => key);
  parsed.summary = `${parsed.overall_score}/12 — ${parsed.decision}. The dimensions needing the most work are ${weak.length ? weak.join(", ") : "none"}.`;
  parsed.rubric_source = "6Ps of CopyTHINKING — Jay Yang (@Jayyanginspires); sub-checks from his longer copywriting essay (docs/jay-yang-copywriting-article.md).";
  parsed.model = env.OPENROUTER_MODEL || MODEL;
  parsed.retention = "Writing is processed for this grading request and is not stored by this tool.";
  return parsed;
}

function nextTrafficThreshold(count) {
  if (count < 100) return Math.ceil((count + 1) / 10) * 10;
  if (count < 1000) return Math.ceil((count + 1) / 100) * 100;
  return Math.ceil((count + 1) / 1000) * 1000;
}
async function sendEmail(env, subject, text) {
  if (!env.BIPU_RESEND_API_KEY) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{"authorization":`Bearer ${env.BIPU_RESEND_API_KEY}`, "content-type":"application/json"},
    body:JSON.stringify({from:env.ALERT_EMAIL_FROM, to:[env.ALERT_EMAIL_TO], subject, text, html:`<p>${text.replace(/\n/g,"<br>")}</p>`})
  });
  return response.ok;
}
async function recordVisit(env, pathname) {
  const id = env.TRAFFIC.idFromName(`page:${pathname.slice(0, 120) || "/"}`);
  await env.TRAFFIC.get(id).fetch("https://traffic/count", {method:"POST", body:JSON.stringify({kind:"pageview", pathname})});
}
async function recordProviderFailure(env, status) {
  const id = env.TRAFFIC.idFromName("provider:openrouter");
  await env.TRAFFIC.get(id).fetch("https://traffic/count", {method:"POST", body:JSON.stringify({kind:"provider_failure", status})});
}

export class TrafficCounter {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    const body = await request.json();
    const now = Date.now();
    const state = await this.state.storage.get("state") || {count:0, last_alert:0, last_provider_alert:0};
    if (body.kind === "provider_failure") {
      if (now - state.last_provider_alert < 3600000) return new Response(JSON.stringify({notified:false, throttled:true}));
      const providerState = Number(body.status) === 402 ? "OpenRouter credits may be exhausted" : "OpenRouter unavailable";
      const subject = `Jay BIPU grader alert: ${providerState} (HTTP ${body.status})`;
      const sent = await sendEmail(this.env, subject, `OpenRouter returned HTTP ${body.status} for the 6Ps grader. Check OpenRouter credits, provider status, and the Worker health endpoint.`);
      if (sent) { state.last_provider_alert = now; await this.state.storage.put("state", state); }
      return new Response(JSON.stringify({notified:sent}));
    }
    state.count += 1;
    const threshold = nextTrafficThreshold(state.count - 1);
    let notified = false;
    if (state.count >= threshold && state.last_alert < threshold) {
      const subject = `Jay BIPU traffic: ${body.pathname || "/"} reached ${state.count} edge page visits`;
      const text = `The page ${body.pathname || "/"} reached ${state.count} edge page requests on jay.buildinpublicuniversity.com.\n\nThis is an operational traffic alert, not a unique-visitor count. Fathom remains the analytics source for visits and events.`;
      notified = await sendEmail(this.env, subject, text);
      if (notified) state.last_alert = state.count;
    }
    await this.state.storage.put("state", state);
    return new Response(JSON.stringify({count:state.count, threshold, notified}));
  }
}
const DEMO_ARCHETYPES = [
  {id:"skimmer", name:"The Skimmer", attentiveness:"low", problem_shape:"hook-first clarity", note:"You have one breath of attention. Reject abstraction."},
  {id:"operator", name:"The Busy Operator", attentiveness:"medium", problem_shape:"a specific Tuesday problem", note:"Reward concrete recognition of a lived operational problem."},
  {id:"skeptic", name:"The Skeptical Buyer", attentiveness:"high", problem_shape:"pointable proof", note:"Do not reward claims that cannot be checked."}
];
const DEMO_MAX_IDEAS = 6;
const DEMO_MAX_ATTEMPTS = 2;

function extractJSON(raw, required) {
  const text = String(raw || "").replace(/<think>/g, "").replace(/<\/think>/g, "");
  const end = text.lastIndexOf("}");
  if (end < 0) throw new Error("provider returned no JSON");
  for (let i = text.lastIndexOf("{", end); i >= 0; i = text.lastIndexOf("{", i - 1)) {
    try {
      const candidate = JSON.parse(text.slice(i, end + 1));
      if (candidate && typeof candidate === "object" && candidate[required]) return candidate;
    } catch {}
  }
  throw new Error("provider returned no usable JSON object");
}
async function demoProvider(env, system, user, maxTokens=2500) {
  if (!env.OPENROUTER_API_KEY) throw new Error("grader_not_configured");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method:"POST",
    headers:{"authorization":`Bearer ${env.OPENROUTER_API_KEY}`, "content-type":"application/json", "http-referer":"https://jay.buildinpublicuniversity.com", "x-title":"BIPU shareable tournament demo"},
    body:JSON.stringify({model:env.OPENROUTER_MODEL || MODEL, temperature:0.35, max_tokens:maxTokens, reasoning:{effort:"none"}, messages:[{role:"system",content:system},{role:"user",content:user}], response_format:{type:"json_object"}})
  });
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  const payload = await response.json();
  const message = payload?.choices?.[0]?.message || {};
  const fields = [message.content, message.reasoning, message.reasoning_details].map(value => typeof value === "string" ? value : Array.isArray(value) ? value.map(part => part?.text || "").join("") : value ? JSON.stringify(value) : "");
  const blob = fields.join("\n");
  for (const required of ["pods", "writing", "verdicts"]) { try { return extractJSON(blob, required); } catch {} }
  throw new Error("provider returned no supported demo object");
}
async function createDemoPods(env, context) {
  const system = `Create a small pain-first content tournament for a public demo. Return JSON with exactly {"pods":[{"name":"pain theme","ideas":["specific one-sentence hook","specific one-sentence hook"]}]}. Create exactly 3 pods with exactly 2 ideas each. Ideas must name a lived reader pain, avoid fabricated proof, and be useful as the opening line of a complete post. Do not include private data.`;
  return (await demoProvider(env, system, `SOURCE / CONTEXT:\n${context}`, 1800)).pods;
}
function localDemoWriting(idea, attempt) {
  const evidence = "[verified receipt needed]";
  const urgency = "[real cost of delay needed]";
  return `${idea}\n\nFor the operator responsible, the pain is not a dramatic outage. It is the silent mismatch between what was configured and what the live system does.\n\nPositioning: this is a verification problem, not another dashboard.\n\nPromise: make the mismatch pointable before it becomes a customer-facing surprise.\n\nProcess: check the account, domain, webhook, and observed response against one explicit receipt.\n\nProof: ${evidence}\nPriority: ${urgency}\n\nIf you can attach those two receipts, this post becomes a claim. Until then, it is a useful hypothesis.`;
}
function localDemoGrade(writing, attempt) {
  return {mode:"demo_simulation", decision:"DEMO_PASS", overall_score:10, scores:{People:2,Positioning:2,Promise:2,Proof:2,Priority:2,Process:2}, release_gate:{passed:false, reason:"Demo simulation only; run the live six-P grader before publication."}, recommendations:["Replace bracketed proof and priority fields with traceable receipts before publishing."]};
}
async function improveDemo(env, idea, draft, feedback) {
  return localDemoWriting(idea, draft ? 1 : 0);
}
async function judgeDemo(env, a, b) {
  const aSignal = (a.match(/\b(account|domain|webhook|receipt|mismatch|customer)\b/gi) || []).length;
  const bSignal = (b.match(/\b(account|domain|webhook|receipt|mismatch|customer)\b/gi) || []).length;
  return ["skimmer","operator","skeptic"].map((judge, index) => ({judge, a:{pain:aSignal > bSignal ? 4 : 3, spec:aSignal > bSignal ? 4 : 3, pull:3}, b:{pain:bSignal > aSignal ? 4 : 3, spec:bSignal > aSignal ? 4 : 3, pull:3}, winner:aSignal >= bSignal ? "A" : "B", why:"Demo comparator favors the draft with more concrete operational pain terms."}));
}
function demoDecide(verdicts) {
  const totals = {A:{pain:0,spec:0,pull:0,votes:0}, B:{pain:0,spec:0,pull:0,votes:0}};
  for (const v of verdicts || []) {
    const side = v.winner === "B" ? "B" : "A";
    totals[side].votes++;
    for (const key of ["pain","spec","pull"]) { totals.A[key] += Number(v.a?.[key] || 0); totals.B[key] += Number(v.b?.[key] || 0); }
  }
  const winner = totals.A.votes === totals.B.votes ? (totals.A.pain >= totals.B.pain ? "A" : "B") : (totals.A.votes > totals.B.votes ? "A" : "B");
  return {winner, totals};
}

async function processDemoBattle(env, runId, run) {
  const pairs=[];
  for (let i=0;i<run.passers.length;i++) for (let j=i+1;j<run.passers.length;j++) pairs.push([i,j]);
  const pair=pairs[run.battle_cursor];
  if (!pair) { run.phase="complete"; run.busy=false; }
  else {
    const a=run.passers[pair[0]], b=run.passers[pair[1]];
    const verdicts=await judgeDemo(env,a.final_writing,b.final_writing);
    const decision=demoDecide(verdicts); const winner=decision.winner==="A"?a:b;
    run.points[`${winner.pod_id}:${winner.seed}`]++;
    run.battles.push({a:{pod_name:a.pod_name,seed:a.seed},b:{pod_name:b.pod_name,seed:b.seed},verdicts,decision,winner:{pod_name:winner.pod_name,seed:winner.seed},mode:"demo_simulation"});
    run.battle_cursor++;
    if (run.battle_cursor>=pairs.length) run.phase="complete";
    run.busy=false;
  }
  const session=env.TOURNAMENT.get(env.TOURNAMENT.idFromName(runId));
  await session.fetch("https://tournament/commit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({run})});
}

async function processDemoStep(env, runId, run) {
  const item = run.ideas[run.cursor];
  try {
    if (!item.pending_writing) {
      const previous = item.attempts[item.attempts.length - 1];
      item.pending_writing = await improveDemo(env, item.idea, previous?.writing || null, previous?.grade || null);
      item.status = "grading";
    } else {
      const writing = item.pending_writing;
      const gradeResult = localDemoGrade(writing, item.attempts.length + 1);
      const attempt = {attempt:item.attempts.length + 1, writing, grade:gradeResult};
      item.attempts.push(attempt);
      delete item.pending_writing;
      item.status = (gradeResult.decision === "PASS" || gradeResult.decision === "DEMO_PASS") && gradeResult.overall_score >= 9 ? "passed" : "improving";
      if (item.status === "passed") { item.final_writing = writing; item.grade = gradeResult; run.passers.push(item); run.points[`${item.pod_id}:${item.seed}`] = 0; run.cursor++; }
      else if (item.attempts.length >= run.max_attempts) { item.status = "unresolved"; run.unresolved.push(item); run.cursor++; }
    }
    if (run.cursor >= run.ideas.length) { run.phase = run.passers.length > 1 ? "battle" : "complete"; run.battle_cursor = 0; }
  } catch (error) {
    item.status = "error";
    item.error = String(error.message || error);
    delete item.pending_writing;
    run.unresolved.push(item);
    run.cursor++;
    if (run.cursor >= run.ideas.length) run.phase = run.passers.length > 1 ? "battle" : "complete";
  }
  run.busy = false;
  const session = env.TOURNAMENT.get(env.TOURNAMENT.idFromName(runId));
  await session.fetch("https://tournament/commit", {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({run})});
}

export class TournamentSession {
  constructor(state, env) { this.state = state; this.env = env; }
  async alarm() {
    const run = await this.state.storage.get("run");
    if (run?.busy && run.run_id) await processDemoStep(this.env, run.run_id, run);
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/claim") {
      const run = await this.state.storage.get("run");
      if (!run) return new Response(JSON.stringify({error:"run_not_found"}), {status:404});
      if (run.busy) { run.busy = false; delete run.busy_since; }
      await this.state.storage.put("run", run);
      return new Response(JSON.stringify({claimed:true, run, snapshot:await this.snapshot()}), {headers:{"content-type":"application/json"}});
    }
    if (request.method === "POST" && url.pathname === "/commit") {
      const body = await request.json();
      if (!body?.run || typeof body.run !== "object") return new Response(JSON.stringify({error:"invalid_run"}), {status:400});
      await this.state.storage.put("run", body.run);
      return new Response(JSON.stringify({ok:true}), {headers:{"content-type":"application/json"}});
    }
    if (request.method === "POST" && url.pathname === "/start") {
      const body = await request.json();
      const context = typeof body?.context === "string" ? body.context.trim() : "";
      if (context.length < 40 || context.length > 4000) return new Response(JSON.stringify({error:"invalid_context"}), {status:400});
      await this.state.storage.put("run", {phase:"creating", run_id:String(body?.run_id || ""), context, pods:[], ideas:[], cursor:0, max_attempts:DEMO_MAX_ATTEMPTS, passers:[], unresolved:[], battles:[], battle_cursor:0, points:{}, created_at:new Date().toISOString()});
      return new Response(JSON.stringify({ok:true}), {headers:{"content-type":"application/json"}});
    }
    if (request.method === "GET" && url.pathname === "/status") return new Response(JSON.stringify(await this.snapshot()), {headers:{"content-type":"application/json"}});
    if (request.method === "POST" && url.pathname === "/step") return new Response(JSON.stringify(await this.step()), {headers:{"content-type":"application/json"}});
    return new Response("not found", {status:404});
  }
  async snapshot() {
    const run = await this.state.storage.get("run");
    if (!run) return {error:"run_not_found"};
    if (run.busy && (!run.busy_since || Date.now() - run.busy_since > 30000)) {
      run.busy = false;
      delete run.busy_since;
      await this.state.storage.put("run", run);
    }
    return {phase:run.phase, busy:Boolean(run.busy), pods:run.pods, ideas:run.ideas.map(({idea, pod_name, seed, status, attempts, final_writing}) => ({idea, pod_name, seed, status, attempts:attempts.map(a => ({attempt:a.attempt, grade:a.grade})), final_writing})), passers:run.passers.map(({idea,pod_name,seed,final_writing,grade}) => ({idea,pod_name,seed,final_writing,grade})), unresolved:run.unresolved, battles:run.battles, points:run.points, cursor:run.cursor, total_ideas:run.ideas.length};
  }
  async processImproving() {
    const run = await this.state.storage.get("run");
    if (!run || run.phase !== "improving") return;
    const item = run.ideas[run.cursor];
    try {
      if (!item.pending_writing) {
        const previous = item.attempts[item.attempts.length - 1];
        item.pending_writing = await improveDemo(this.env, item.idea, previous?.writing || null, previous?.grade || null);
        item.status = "grading";
      } else {
        const writing = item.pending_writing;
        const gradeResult = await grade(writing, this.env);
        const attempt = {attempt:item.attempts.length + 1, writing, grade:gradeResult};
        item.attempts.push(attempt);
        delete item.pending_writing;
        item.status = (gradeResult.decision === "PASS" || gradeResult.decision === "DEMO_PASS") && gradeResult.overall_score >= 9 ? "passed" : "improving";
        if (item.status === "passed") { item.final_writing = writing; item.grade = gradeResult; run.passers.push(item); run.points[`${item.pod_id}:${item.seed}`] = 0; run.cursor++; }
        else if (item.attempts.length >= run.max_attempts) { item.status = "unresolved"; run.unresolved.push(item); run.cursor++; }
      }
      if (run.cursor >= run.ideas.length) { run.phase = run.passers.length > 1 ? "battle" : "complete"; run.battle_cursor = 0; }
    } catch (error) {
      item.status = "error";
      item.error = String(error.message || error);
      delete item.pending_writing;
      run.unresolved.push(item);
      run.cursor++;
      if (run.cursor >= run.ideas.length) run.phase = run.passers.length > 1 ? "battle" : "complete";
    }
    run.busy = false;
    await this.state.storage.put("run", run);
  }
  async step() {
    const run = await this.state.storage.get("run");
    if (!run) return {error:"run_not_found"};
    if (run.phase === "complete") return this.snapshot();
    if (run.phase === "creating") {
      try {
        run.pods = await createDemoPods(this.env, run.context);
        if (!Array.isArray(run.pods) || run.pods.length !== 3 || run.pods.some(p => !p.name || !Array.isArray(p.ideas) || p.ideas.length !== 2)) throw new Error("provider returned invalid pods");
        run.ideas = run.pods.flatMap((pod, podIndex) => pod.ideas.map((text, seed) => ({pod_id:podIndex, pod_name:pod.name, seed, idea:String(text), status:"queued", attempts:[]})));
        delete run.context;
        run.phase = "improving";
      } catch (error) { run.phase = "error"; run.error = String(error.message || error); }
      await this.state.storage.put("run", run);
      return this.snapshot();
    }
    if (run.phase === "improving") {
      if (run.busy) return this.snapshot();
      run.busy = true;
      await this.state.storage.put("run", run);
      this.state.waitUntil(this.processImproving());
      return this.snapshot();
    }
    if (run.phase === "battle") {
      const pairs = [];
      for (let i=0;i<run.passers.length;i++) for (let j=i+1;j<run.passers.length;j++) pairs.push([i,j]);
      const pair = pairs[run.battle_cursor];
      if (!pair) { run.phase = "complete"; await this.state.storage.put("run", run); return this.snapshot(); }
      try {
        const [ia, ib] = pair;
        const a = run.passers[ia], b = run.passers[ib];
        const verdicts = await judgeDemo(this.env, a.final_writing, b.final_writing);
        const decision = demoDecide(verdicts);
        const winner = decision.winner === "A" ? a : b;
        run.points[`${winner.pod_id}:${winner.seed}`]++;
        run.battles.push({a:{pod_name:a.pod_name,seed:a.seed}, b:{pod_name:b.pod_name,seed:b.seed}, verdicts, decision, winner:{pod_name:winner.pod_name,seed:winner.seed}});
      } catch (error) { run.battles.push({error:String(error.message || error), pair}); }
      run.battle_cursor++;
      if (run.battle_cursor >= pairs.length) run.phase = "complete";
      await this.state.storage.put("run", run);
      return this.snapshot();
    }
    return this.snapshot();
  }
}

export class TournamentJob {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    if (request.method === "POST" && new URL(request.url).pathname === "/start") {
      const body = await request.json();
      await this.state.storage.put("run", body.run);
      await this.state.storage.setAlarm(Date.now() + 100);
      return new Response(JSON.stringify({ok:true}), {headers:{"content-type":"application/json"}});
    }
    return new Response("Not found", {status:404});
  }
  async alarm() {
    const run = await this.state.storage.get("run");
    if (run) await processDemoStep(this.env, run.run_id, run);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") return new Response(null, {status:204, headers:{"access-control-allow-origin":cors(origin),"access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type","access-control-max-age":"86400"}});
    if (url.pathname === "/api/health") return json({ok:true, model:env.OPENROUTER_MODEL || MODEL, provider:"openrouter", configured:Boolean(env.OPENROUTER_API_KEY), fathom_site_id:env.FATHOM_SITE_ID, traffic_alerts:true, tournament_demo:true}, 200, origin);
    if (url.pathname === "/api/tournament/start" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({error:"invalid_json", message:"Send JSON with a context field."}, 400, origin); }
      const context = typeof body?.context === "string" ? body.context.trim() : "";
      if (context.length < 40) return json({error:"context_too_short", message:"Give the tournament a topic, audience, offer, or source context of at least 40 characters."}, 400, origin);
      if (context.length > 4000) return json({error:"context_too_long", message:"Keep the demo context under 4,000 characters."}, 400, origin);
      try {
        const runId = crypto.randomUUID();
        const id = env.TOURNAMENT.idFromName(runId);
        const session = env.TOURNAMENT.get(id);
        const started = await session.fetch("https://tournament/start", {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({context, run_id:runId})});
        if (!started.ok) return json({error:"session_start_failed", status:started.status, message:"The tournament session could not be created."}, 502, origin);
        return json({run_id:runId, share_path:`/tournament/?run=${encodeURIComponent(runId)}`}, 200, origin);
      } catch (error) { return json({error:"tournament_start_failed", message:"The demo could not create a session. Try again."}, 502, origin); }
    }
    if (url.pathname === "/api/tournament/status" && request.method === "GET") {
      const runId = url.searchParams.get("run");
      if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) return json({error:"invalid_run_id", message:"That share link is not a valid tournament run."}, 400, origin);
      const session = env.TOURNAMENT.get(env.TOURNAMENT.idFromName(runId));
      return json(await (await session.fetch("https://tournament/status")).json(), 200, origin);
    }
    if (url.pathname === "/api/tournament/step" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({error:"invalid_json", message:"Send a run field."}, 400, origin); }
      const runId = typeof body?.run === "string" ? body.run : "";
      if (!/^[0-9a-f-]{36}$/i.test(runId)) return json({error:"invalid_run_id", message:"That tournament run is not valid."}, 400, origin);
      const session = env.TOURNAMENT.get(env.TOURNAMENT.idFromName(runId));
      const current = await (await session.fetch("https://tournament/status")).json();
      if (current.phase === "creating") return json(await (await session.fetch("https://tournament/step", {method:"POST"})).json(), 200, origin);
      const claimed = await (await session.fetch("https://tournament/claim", {method:"POST"})).json();
      if (claimed.claimed && claimed.run?.phase === "improving") {
        await processDemoStep(env, runId, claimed.run);
        return json(await (await session.fetch("https://tournament/status")).json(), 200, origin);
      }
      if (claimed.claimed && claimed.run?.phase === "battle") {
        await processDemoBattle(env, runId, claimed.run);
        return json(await (await session.fetch("https://tournament/status")).json(), 200, origin);
      }
      return json(claimed.snapshot || claimed, 200, origin);
    }
    if (url.pathname === "/api/grade" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({error:"invalid_json", message:"Send JSON with a writing field."}, 400, origin); }
      const text = typeof body?.writing === "string" ? body.writing.trim() : "";
      if (text.length < 80) return json({error:"writing_too_short", message:"Give the evaluator at least 80 characters to work with."}, 400, origin);
      if (text.length > MAX_CHARS) return json({error:"writing_too_long", message:`Keep the submission under ${MAX_CHARS.toLocaleString()} characters.`}, 400, origin);
      const result = await grade(text, env);
      if (result.error === "provider_error") ctx.waitUntil(recordProviderFailure(env, result.status));
      return json(result, result.error ? (result.error === "grader_not_configured" ? 503 : 502) : 200, origin);
    }
    const acceptsHtml = (request.headers.get("accept") || "").includes("text/html");
    if (request.method === "GET" && !url.pathname.startsWith("/api/") && acceptsHtml) ctx.waitUntil(recordVisit(env, url.pathname));
    const assetResponse = await env.ASSETS.fetch(request);
    if (!acceptsHtml) return assetResponse;
    const headers = new Headers(assetResponse.headers);
    headers.set("cache-control", "no-store, max-age=0");
    return new Response(assetResponse.body, {status:assetResponse.status, statusText:assetResponse.statusText, headers});
  }
};
