#!/usr/bin/env python3
"""Evolve every idea through the live 6Ps gate, then battle only passers.

The evolution phase is deliberately bounded: a candidate gets at most N
improvement cycles. Candidates that never PASS remain in `unresolved`; they do
not enter the versus bracket and are not silently discarded.

Usage:
  python3 evolving_tournament.py pods.json --out evolving_report.json --dry-run
  python3 evolving_tournament.py pods.json --out evolving_report.json --max-attempts 5
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import tournament

BASE = Path(__file__).resolve().parent
GRADE_URL = "https://jay.buildinpublicuniversity.com/api/grade"
MODEL = "deepseek/deepseek-v4-flash"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
ENV_PATH = Path.home() / ".hermes/.env"

IMPROVE_SYSTEM = """You are a senior copy editor improving a draft through Jay Yang's 6Ps of CopyTHINKING: People, Positioning, Promise, Proof, Priority, Process.

The goal is not prettier language. Preserve the reader's specific felt pain,
then repair the weakest dimensions. Never invent testimonials, results,
deadlines, scarcity, statistics, named customers, citations, or other facts.
If proof is missing, use a clearly marked placeholder such as [verified receipt]
rather than fabricating evidence. If priority is missing, use [real deadline or
cost of delay] rather than inventing urgency.

Return only JSON with exactly one field: {"writing":"the complete improved piece"}.
The writing must stand alone, retain a clear hook, body, and CTA, and be under
12000 characters."""


def load_key() -> str | None:
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"]
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if line.startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1].strip()
    return None


def extract_object(blob: str, required: str) -> dict:
    blob = blob.replace("<think>", "").replace("</think>", "")
    end = blob.rfind("}")
    if end < 0:
        raise ValueError("provider returned no JSON object")
    for i in range(blob.rfind("{", 0, end), -1, -1):
        try:
            candidate = json.loads(blob[i:end + 1])
        except Exception:
            continue
        if isinstance(candidate, dict) and required in candidate:
            return candidate
    raise ValueError(f"provider returned no object containing {required}")


def improve(key: str, original_idea: str, draft: str | None, feedback: dict | None, attempt: int) -> str:
    if draft is None:
        instruction = f"Expand this hook into a complete piece while preserving its pain: {original_idea}"
    else:
        instruction = (
            "Improve the complete draft using the latest live grader result. "
            "Fix the weakest dimensions first, preserve verified claims, and return the full revised piece.\n"
            f"LIVE GRADER RESULT:\n{json.dumps(feedback, ensure_ascii=False)}\n\nCURRENT DRAFT:\n{draft}"
        )
    body = json.dumps({
        "model": MODEL,
        "temperature": 0.4,
        "max_tokens": 3000,
        "reasoning": {"effort": "low"},
        "messages": [
            {"role": "system", "content": IMPROVE_SYSTEM},
            {"role": "user", "content": instruction},
        ],
        "response_format": {"type": "json_object"},
    }).encode()
    req = urllib.request.Request(OPENROUTER_URL, data=body, headers={
        "authorization": f"Bearer {key}", "content-type": "application/json",
        "http-referer": "https://jay.buildinpublicuniversity.com",
        "x-title": "Jay BIPU 6Ps Evolution Phase",
    })
    for n in range(3):
        try:
            with urllib.request.urlopen(req, timeout=150) as response:
                payload = json.load(response)
            message = payload["choices"][0]["message"]
            blob = "\n".join(str(message.get(k) or "") for k in ("content", "reasoning"))
            obj = extract_object(blob, "writing")
            writing = obj["writing"]
            if not isinstance(writing, str) or len(writing.strip()) < 80:
                raise ValueError("provider returned a short writing")
            return writing.strip()
        except Exception:
            if n == 2:
                raise
            time.sleep(2 * (n + 1))
    raise RuntimeError("unreachable")


def grade(writing: str) -> dict:
    body = json.dumps({"writing": writing}).encode()
    req = urllib.request.Request(GRADE_URL, data=body, headers={
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "jay-bipu-evolution/1.0",
        "origin": "https://jay.buildinpublicuniversity.com",
    })
    with urllib.request.urlopen(req, timeout=240) as response:
        return json.load(response)


def passed(result: dict) -> bool:
    return result.get("decision") == "PASS" and result.get("overall_score", 0) >= 9


def evolve_pod(key: str | None, pod: dict, max_attempts: int, dry: bool) -> dict:
    entries, passed_entries, unresolved = [], [], []
    for seed, idea in enumerate(pod["ideas"]):
        item = {"seed": seed, "idea": idea, "attempts": [], "status": "pending"}
        if dry:
            item["status"] = "dry_run_pending"
            entries.append(item)
            continue
        draft = None
        feedback = None
        for attempt in range(1, max_attempts + 1):
            draft = improve(key, idea, draft, feedback, attempt)
            feedback = grade(draft)
            item["attempts"].append({"attempt": attempt, "grade": feedback, "writing": draft})
            if passed(feedback):
                item["status"] = "passed"
                item["final_writing"] = draft
                passed_entries.append(item)
                break
        if item["status"] != "passed":
            item["status"] = "unresolved"
            unresolved.append(item)
        entries.append(item)
    return {"name": pod["name"], "entries": entries, "passed": passed_entries, "unresolved": unresolved}


def battle(key: str, passers: list[dict]) -> dict:
    tournament.ARCHETYPES = battle.archetypes
    points = {f"{x['pod_id']}:{x['seed']}": 0 for x in passers}
    matches = []
    for i in range(len(passers)):
        for j in range(i + 1, len(passers)):
            a, b = passers[i], passers[j]
            verdicts = [tournament.judge_matchup(key, arch, a["final_writing"], b["final_writing"]) for arch in battle.archetypes]
            winner, score_a, score_b = tournament.decide(verdicts)
            winner_item = a if winner == "A" else b
            points[f"{winner_item['pod_id']}:{winner_item['seed']}"] += 1
            matches.append({
                "a": {"pod_id": a["pod_id"], "seed": a["seed"]},
                "b": {"pod_id": b["pod_id"], "seed": b["seed"]},
                "scores": {"a": score_a, "b": score_b},
                "winner": {"pod_id": winner_item["pod_id"], "seed": winner_item["seed"]},
                "judges": verdicts,
            })
    champion = max(points, key=points.get) if points else None
    return {"eligible_count": len(passers), "points": points, "matches": matches, "champion": champion}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pods_file")
    parser.add_argument("--out", default="evolving_report.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-attempts", type=int, default=5)
    args = parser.parse_args()
    if args.max_attempts < 1:
        parser.error("--max-attempts must be >= 1")
    spec = json.loads(Path(args.pods_file).read_text())
    key = None if args.dry_run else load_key()
    if not key and not args.dry_run:
        sys.exit("OPENROUTER_API_KEY not found in env or ~/.hermes/.env")
    battle.archetypes = spec["judge_archetypes"]
    report = {
        "meta": spec["meta"],
        "phase": "improve_until_pass_then_vs_battle",
        "gate": "production 6Ps grader: PASS, all P >= 1, People/Promise/Proof = 2, total >= 9/12",
        "max_attempts": args.max_attempts,
        "dry_run": args.dry_run,
        "pods": {},
        "battle": None,
    }
    passers = []
    for pod in spec["pods"]:
        print(f"== Improve: {pod['name']} ({len(pod['ideas'])} ideas)")
        result = evolve_pod(key, pod, args.max_attempts, args.dry_run)
        report["pods"][pod["id"]] = result
        for item in result["passed"]:
            passers.append({"pod_id": pod["id"], "pod_name": pod["name"], **item})
        print(f"   passed={len(result['passed'])} unresolved={len(result['unresolved'])}")
    if args.dry_run:
        report["battle"] = {"skipped": "dry-run", "would_battle_passers_only": True}
    elif len(passers) >= 2:
        report["battle"] = battle(key, passers)
    else:
        report["battle"] = {"skipped": "fewer_than_two_passers", "eligible_count": len(passers)}
    out = BASE / args.out if not os.path.isabs(args.out) else Path(args.out)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"\nreport -> {out}")


if __name__ == "__main__":
    main()
