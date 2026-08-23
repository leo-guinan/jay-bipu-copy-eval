const writing = document.querySelector('#writing');
const counter = document.querySelector('#counter');
const button = document.querySelector('#grade');
const error = document.querySelector('#error');
const result = document.querySelector('#result');
const track = (name) => { if (window.fathom) window.fathom.trackEvent(name); };
writing.addEventListener('input', () => counter.textContent = `${writing.value.length.toLocaleString()} / 12,000`);
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function render(data) {
  const decision = String(data.decision || 'REVISE').toLowerCase();
  const score = Number.isFinite(data.overall_score) ? data.overall_score : Object.values(data.scores || {}).reduce((a,b)=>a+Number(b||0),0);
  const recs = Array.isArray(data.recommendations) ? data.recommendations.slice(0,3) : [];
  result.hidden = false;
  result.innerHTML = `<div class="result-card"><div class="result-top"><div><span class="decision ${esc(decision)}">${esc(data.decision)}</span><h2>Here is where the copy breaks.</h2></div><div class="score">${score}<small> / 12</small></div></div><p class="summary">${esc(data.summary || 'Three changes will make the thinking more legible.')}</p><div class="rec-grid">${recs.map((r,i)=>`<article class="rec"><b>Fix ${i+1} · ${esc(r.dimension)}</b><h3>${esc(r.problem)}</h3><p class="fix">${esc(r.fix)}</p></article>`).join('')}</div><div class="result-cta"><span>Take the longer route with Jay’s book.</span><a class="button" href="https://www.kickstarter.com/projects/jayyanginspires/work-with-the-best" target="_blank" rel="noopener">Visit the book presale <span>↗</span></a></div></div>`;
  result.scrollIntoView({behavior:'smooth', block:'start'});
}
button.addEventListener('click', async () => {
  error.hidden = true;
  const text = writing.value.trim();
  if (text.length < 80) { error.textContent = 'Give the evaluator at least 80 characters to work with.'; error.hidden = false; return; }
  button.disabled = true; button.innerHTML = 'Thinking through the six Ps <span>…</span>';
  track('copy_eval_started');
  try {
    const res = await fetch('/api/grade', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({writing:text})});
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'The grader could not complete this run.');
    render(data);
    track('copy_eval_completed');
  } catch (e) { error.textContent = e.message; error.hidden = false; }
  finally { button.disabled = false; button.innerHTML = 'Run the 6Ps eval <span>↗</span>'; }
});
document.querySelectorAll('a[href*="kickstarter.com/projects/jayyanginspires/work-with-the-best"]').forEach(link => link.addEventListener('click', () => track('presale_clicked')));
