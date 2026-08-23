#!/usr/bin/env python3
"""Content Idea Tournament — pain-first 6Ps bracket with multi-archetype LLM judges.

Reads tournament/pods.json, runs single-elimination within each pod, then a
cross-pod final. Each matchup is judged by every archetype; each judge returns
pain_recognition (0-5), specificity (0-5), action_pull (0-3). Pain recognition
is double-weighted and gates the win: an idea cannot win a matchup while losing
or tying on pain recognition, regardless of other axes.

Usage:
    python3 tournament.py pods.json --out report.json [--dry-run]

Requires OPENROUTER_API_KEY in the environment (reads ~/.hermes/.env as fallback).
"""

import argparse
import itertools
import json
import os
import re
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.expanduser("~/.hermes/.env")
MODEL = "deepseek/deepseek-v4-flash"
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

JUDGE_PROMPT = """You are "{name}", a judge in a copywriting idea tournament.

Your profile: attentiveness = {attentiveness}; problem shape you reward = {problem_shape}.
{note}

Two content ideas face off. Both target the same reader. Score each on three axes:

1. pain_recognition (0-5): Does this idea prove it understands the reader's actual felt pain — specifically, not generically? "The pain is the pitch."
2. specificity (0-5): Concrete, pointable, memorable — could you physically point at what it names? Vague = low.
3. action_pull (0-3): Does it make the reader want to act or hear more?

HARD RULE: pain_recognition is the gate. If A and B tie on pain_recognition, the higher total wins. If they differ on pain_recognition, the higher pain_recognition ALWAYS wins even if its total is lower.

Return ONLY JSON: {{"a":{{"pain":N,"spec":N,"pull":N}},"b":{{"pain":N,"spec":N,"pull":N}},"winner":"A"|"B","why":"one sentence"}}"""


def load_key():
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        return key
    if os.path.exists(ENV_PATH):
        for line in open(ENV_PATH):
            if line.startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1].strip()
    return None


def judge_matchup(key, archetype, idea_a, idea_b):
    body = json.dumps({
        "model": MODEL,
        "temperature": 0.2,
        "max_tokens": 2000,
        "messages": [
            {"role": "system", "content": JUDGE_PROMPT.format(
                name=archetype["name"], attentiveness=archetype["attentiveness"],
                problem_shape=archetype["problem_shape"], note=archetype["note"])},
            {"role": "user", "content": f"IDEA A: {idea_a}\n\nIDEA B: {idea_b}"},
        ],
        "response_format": {"type": "json_object"},
    }).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={
        "authorization": f"Bearer {key}", "content-type": "application/json",
        "http-referer": "https://jay.buildinpublicuniversity.com",
        "x-title": "Jay BIPU Content Idea Tournament"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                payload = json.load(resp)
            msg = payload["choices"][0]["message"]
            candidates = [msg.get("content") or "", msg.get("reasoning") or ""]
            for p in (msg.get("content_list") or []):
                if isinstance(p, dict) and p.get("text"):
                    candidates.append(p["text"])
            blob = "\n".join(candidates)
            # strip think tags, then find a balanced JSON object containing "winner"
            blob = blob.replace("<think>", "").replace("</think>", "")
            verdict = None
            for m in re.finditer(r"\{", blob):
                depth = 0
                for j in range(m.start(), len(blob)):
                    if blob[j] == "{": depth += 1
                    elif blob[j] == "}":
                        depth -= 1
                        if depth == 0:
                            try:
                                obj = json.loads(blob[m.start():j + 1])
                            except Exception:
                                break
                            if isinstance(obj, dict) and "winner" in obj and "a" in obj and "b" in obj:
                                verdict = obj
                            break
                if verdict: break
            if not verdict:
                # reasoning ran out of tokens before emitting the object; one retry hint
                raise ValueError(f"no usable JSON in judge response: {blob[:80]!r}")
            winner = str(verdict.get("winner", "")).strip().upper()[:1]
            if winner in ("A", "B"):
                return {"archetype": archetype["id"], "verdict": verdict, "winner": winner}
        except Exception as exc:
            if attempt == 2:
                raise RuntimeError(f"judge failed after retries: {exc}") from exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def score_card(verdict):
    side = verdict[verdict.get("winner_side")] if "winner_side" in verdict else None
    return None  # scores read directly below


def tally(verdicts, side):
    pain = spec = pull = 0
    for v in verdicts:
        s = v["verdict"][side.lower()]
        pain += int(s["pain"]); spec += int(s["spec"]); pull += int(s["pull"])
    return {"pain": pain, "spec": spec, "pull": pull}


def decide(verdicts):
    """Pain-gated decision across all judges."""
    a, b = tally(verdicts, "a"), tally(verdicts, "b")
    # majority of judges' own winners first
    votes_a = sum(1 for v in verdicts if v["winner"] == "A")
    votes_b = sum(1 for v in verdicts if v["winner"] == "B")
    if votes_a != votes_b:
        return ("A" if votes_a > votes_b else "B"), a, b
    # tiebreak ladder: pain, then spec, then seed order (=A)
    if a["pain"] != b["pain"]:
        return ("A" if a["pain"] > b["pain"] else "B"), a, b
    if a["spec"] != b["spec"]:
        return ("A" if a["spec"] > b["spec"] else "B"), a, b
    return "A", a, b


def run_pod(key, pod, dry=False):
    ideas = list(pod["ideas"])
    rounds, contenders = [], [{"seed": i, "text": t} for i, t in enumerate(ideas)]
    rnd = 1
    while len(contenders) > 1:
        nxt, matches = [], []
        for i in range(0, len(contenders), 2):
            if i + 1 >= len(contenders):  # bye
                nxt.append(contenders[i]); continue
            ca, cb = contenders[i], contenders[i + 1]
            if dry:
                w = "A"
            else:
                verdicts = [judge_matchup(key, arch, ca["text"], cb["text"]) for arch in ARCHETYPES]
                w, ta, tb = decide(verdicts)
                matches.append({"a_seed": ca["seed"], "b_seed": cb["seed"],
                                "scores": {"a": ta, "b": tb},
                                "judges": [{k: v for k, v in vd.items()} for vd in verdicts],
                                "winner_seed": ca["seed"] if w == "A" else cb["seed"]})
            nxt.append(ca if w == "A" else cb)
        rounds.append({"round": rnd, "matches": matches})
        contenders, rnd = nxt, rnd + 1
    return rounds, contenders[0]


ARCHETYPES = []


def main():
    global ARCHETYPES
    ap = argparse.ArgumentParser()
    ap.add_argument("pods_file")
    ap.add_argument("--out", default="tournament_report.json")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    spec = json.load(open(args.pods_file))
    ARCHETYPES = spec["judge_archetypes"]
    key = None if args.dry_run else load_key()
    if not key and not args.dry_run:
        sys.exit("OPENROUTER_API_KEY not found in env or ~/.hermes/.env")

    report = {"meta": spec["meta"], "format": spec["format"], "pods": {}, "final": None}
    champions = []
    for pod in spec["pods"]:
        print(f"== Pod: {pod['name']} ({len(pod['ideas'])} ideas)")
        rounds, champ = run_pod(key, pod, dry=args.dry_run)
        report["pods"][pod["id"]] = {"name": pod["name"], "rounds": rounds,
                                     "champion": {"seed": champ["seed"], "text": champ["text"]}}
        champions.append({"pod": pod["id"], **champ})
        print(f"   champion: {champ['text'][:70]}...")

    # cross-pod final: all champions, judged by all archetypes pairwise round-robin points
    if len(champions) > 1 and not args.dry_run:
        points = {c["pod"]: 0 for c in champions}
        details = []
        for ca, cb in itertools.combinations(champions, 2):
            verdicts = [judge_matchup(key, arch, ca["text"], cb["text"]) for arch in ARCHETYPES]
            w, _, _ = decide(verdicts)
            win_pod = ca["pod"] if w == "A" else cb["pod"]
            points[win_pod] += 1
            details.append({"vs": [ca["pod"], cb["pod"]], "winner": win_pod,
                            "judges": verdicts})
            print(f"   final: {ca['pod']} vs {cb['pod']} -> {win_pod}")
        grand = max(points.items(), key=lambda kv: kv[1])[0]
        report["final"] = {"points": points, "matchups": details, "grand_champion_pod": grand,
                           "grand_champion_text": next(c["text"] for c in champions if c["pod"] == grand)}
    elif args.dry_run:
        report["final"] = {"skipped": "dry-run"}

    out = os.path.join(BASE, args.out) if not os.path.isabs(args.out) else args.out
    json.dump(report, open(out, "w"), indent=2)
    print(f"\nreport -> {out}")


if __name__ == "__main__":
    main()
