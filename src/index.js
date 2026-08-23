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
    body: JSON.stringify({model: env.OPENROUTER_MODEL || MODEL, temperature:0.2, max_tokens:1400, messages:[
      {role:"system", content:SYSTEM},
      {role:"user", content:`Grade this writing using the 6Ps. The release gate is: every P >= 1, People/Promise/Proof = 2, total >= 9/12. Return exactly three recommendations, prioritised by expected improvement.\n\nWRITING:\n${text}`}
    ], response_format:{type:"json_schema", json_schema:{name:"six_ps_copy_eval", strict:true, schema}}})
  });
  if (!response.ok) return {error:"provider_error", status:response.status, message:"The grader could not complete this run. Try again in a moment."};
  const payload = await response.json();
  const rawContent = payload?.choices?.[0]?.message?.content;
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
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("no JSON object");
      parsed = JSON.parse(cleaned.slice(start, end + 1));
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
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") return new Response(null, {status:204, headers:{"access-control-allow-origin":cors(origin),"access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type","access-control-max-age":"86400"}});
    if (url.pathname === "/api/health") return json({ok:true, model:env.OPENROUTER_MODEL || MODEL, provider:"openrouter", configured:Boolean(env.OPENROUTER_API_KEY), fathom_site_id:env.FATHOM_SITE_ID, traffic_alerts:true}, 200, origin);
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
