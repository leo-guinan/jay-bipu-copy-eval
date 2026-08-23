const context = document.querySelector('#context');
const start = document.querySelector('#start');
const setup = document.querySelector('#setup');
const runPanel = document.querySelector('#run');
const podsEl = document.querySelector('#pods');
const battlesEl = document.querySelector('#battles');
const winnerEl = document.querySelector('#winner');
const errorEl = document.querySelector('#error');
const phaseLabel = document.querySelector('#phase-label');
const phaseTitle = document.querySelector('#phase-title');
const progressBar = document.querySelector('#progress-bar');
const runNote = document.querySelector('#run-note');
const share = document.querySelector('#share');
let runId = new URLSearchParams(location.search).get('run');
let busy = false;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const track = name => { if (window.fathom) window.fathom.trackEvent(name); };
context.addEventListener('input', () => document.querySelector('#context-count').textContent = `${context.value.length.toLocaleString()} / 4,000`);
function showError(message) { errorEl.textContent = message; errorEl.hidden = false; }
function statusLabel(status) { return status === 'passed' ? 'qualified' : status === 'unresolved' ? 'stalled' : status === 'error' ? 'error' : status; }
function render(data) {
  if (data.error) { showError(data.message || data.error); return; }
  setup.hidden = true; runPanel.hidden = false;
  const phase = data.phase;
  const completed = data.ideas.filter(x => ['passed','unresolved','error'].includes(x.status)).length;
  const battleCount = data.battles?.length || 0;
  const totalBattles = data.passers ? Math.max(0, data.passers.length * (data.passers.length - 1) / 2) : 0;
  const progress = phase === 'improving' ? (completed / data.total_ideas) * 70 : phase === 'battle' ? 70 + (totalBattles ? battleCount / totalBattles * 30 : 0) : 100;
  progressBar.style.width = `${Math.max(3, progress)}%`;
  if (phase === 'creating') { phaseLabel.textContent = '02 / Creating pain pods'; phaseTitle.textContent = 'The machine is finding the reader pain first.'; runNote.textContent = 'One bounded provider call is generating three pain-themed pods. The context is not in the share URL.'; }
  else if (phase === 'improving') { phaseLabel.textContent = '02 / Improve until pass'; phaseTitle.textContent = 'Every idea has to earn its way into the bracket.'; runNote.textContent = `Processed ${completed} of ${data.total_ideas} ideas. A failed gate stays visible; it does not become a secret rejection.`; }
  else if (phase === 'battle') { phaseLabel.textContent = '03 / Versus'; phaseTitle.textContent = 'Only passing pieces are allowed to fight.'; runNote.textContent = `${data.passers.length} pieces passed the live 6Ps gate. The judges are comparing pain recognition, specificity, and action pull.`; }
  else { phaseLabel.textContent = '04 / Read the receipt'; phaseTitle.textContent = 'The winner is a candidate. Reality still gets the last vote.'; runNote.textContent = `${data.passers.length} qualified · ${data.unresolved.length} unresolved · ${data.battles.length} battle receipts.`; }
  podsEl.innerHTML = data.pods.map((pod, pi) => `<article class="pod-card"><span class="pod-index">Pod ${pi+1}</span><h3>${esc(pod.name)}</h3>${pod.ideas.map((idea, seed) => { const item = data.ideas.find(x => x.pod_name === pod.name && x.seed === seed); const attempts = item?.attempts?.length || 0; return `<div class="idea"><span class="status ${esc(item?.status || '')}">${esc(statusLabel(item?.status || 'queued'))}${attempts ? ` · ${attempts} attempt${attempts>1?'s':''}`:''}</span><p>${esc(idea)}</p>${item?.grade ? `<small class="muted">${esc(item.grade.overall_score)}/12 · ${esc(item.grade.decision)}</small>` : ''}</div>`; }).join('')}</article>`).join('');
  battlesEl.innerHTML = (data.battles || []).map((battle, i) => battle.error ? `<article class="battle-card"><h3>Battle ${i+1} / provider failure</h3><p>${esc(battle.error)}</p></article>` : `<article class="battle-card"><h3>${esc(battle.a.pod_name)} <span>vs</span> ${esc(battle.b.pod_name)}</h3><p>Winner: <strong>${esc(battle.winner.pod_name)}</strong></p><p>${(battle.verdicts || []).map(v => `${esc(v.judge)} → ${esc(v.winner)}`).join(' · ')}</p><p>${esc(battle.verdicts?.[0]?.why || '')}</p></article>`).join('');
  if (phase === 'complete' && data.passers.length) {
    const winnerKey = Object.entries(data.points).sort((a,b) => b[1]-a[1])[0]?.[0];
    const winner = data.passers.find(x => `${x.pod_name === data.passers[0]?.pod_name ? 0 : ''}:${x.seed}` === winnerKey) || data.passers.find(x => winnerKey?.endsWith(`:${x.seed}`));
    const best = data.passers.slice().sort((a,b) => (data.points[`${b.pod_id}:${b.seed}`]||0) - (data.points[`${a.pod_id}:${a.seed}`]||0))[0];
    if (best) { winnerEl.hidden = false; winnerEl.innerHTML = `<p class="eyebrow">Grand champion / model prior</p><h2>${esc(best.pod_name)}</h2><blockquote>${esc(best.final_writing)}</blockquote><p class="receipt">${esc(data.points[`${best.pod_id}:${best.seed}`] || 0)} battle points · live 6Ps grade ${esc(best.grade?.overall_score)}/12 · ${esc(best.grade?.decision)}</p>`; }
  }
}
async function getStatus() { const res = await fetch(`/api/tournament/status?run=${encodeURIComponent(runId)}`); return res.json(); }
async function step() { const res = await fetch('/api/tournament/step', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({run:runId})}); return res.json(); }
async function runLoop() {
  if (busy || !runId) return; busy = true;
  try {
    let data = await getStatus(); render(data);
    while (data.phase !== 'complete' && data.phase !== 'error') {
      if (data.busy) { await new Promise(resolve => setTimeout(resolve, 1800)); data = await getStatus(); render(data); continue; }
      data = await step(); render(data);
    }
    if (data.phase === 'complete') track('tournament_completed');
  } catch (e) { showError(e.message || 'The shared run could not be read.'); }
  finally { busy = false; }
}
start.addEventListener('click', async () => {
  errorEl.hidden = true; const value = context.value.trim();
  if (value.length < 40) return showError('Give the tournament at least 40 characters of context.');
  start.disabled = true; start.innerHTML = 'Creating pain pods <span>…</span>'; track('tournament_started');
  try { const res = await fetch('/api/tournament/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context:value})}); const data = await res.json(); if (!res.ok) throw new Error(data.message || 'Could not start the tournament.'); runId = data.run_id; history.replaceState({},'',data.share_path); render({phase:'creating',pods:[],ideas:[],total_ideas:6,passers:[],unresolved:[],battles:[]}); await runLoop(); } catch (e) { showError(e.message); } finally { start.disabled = false; start.innerHTML = 'Create the pods <span>↗</span>'; }
});
share.addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); share.textContent = 'Link copied ✓'; share.classList.add('share-copied'); setTimeout(()=>{share.textContent='Copy share link ↗';share.classList.remove('share-copied')},2200); } catch { showError('Copy failed. Share the URL from your address bar.'); } });
if (runId) runLoop();
