#!/usr/bin/env python3
"""Build precomputed dataset for static Election69 dashboard."""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import math
import random
from collections import defaultdict
from pathlib import Path
from typing import Any


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def quantile(values: list[int], q: float) -> float:
    if not values:
        return 0.0
    if q <= 0:
        return float(min(values))
    if q >= 1:
        return float(max(values))
    vals = sorted(values)
    pos = (len(vals) - 1) * q
    low = int(pos)
    high = min(low + 1, len(vals) - 1)
    frac = pos - low
    return vals[low] * (1 - frac) + vals[high] * frac


def mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mu = mean(values)
    var = sum((v - mu) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(max(var, 0.0))


def safe_div(a: float, b: float) -> float:
    return a / b if b else 0.0


def solve_linear_system(matrix: list[list[float]], vector: list[float]) -> list[float]:
    n = len(vector)
    aug = [row[:] + [vector[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = col
        for r in range(col + 1, n):
            if abs(aug[r][col]) > abs(aug[pivot][col]):
                pivot = r
        if abs(aug[pivot][col]) < 1e-12:
            continue
        if pivot != col:
            aug[col], aug[pivot] = aug[pivot], aug[col]
        pivot_val = aug[col][col]
        for c in range(col, n + 1):
            aug[col][c] /= pivot_val
        for r in range(n):
            if r == col:
                continue
            factor = aug[r][col]
            if factor == 0:
                continue
            for c in range(col, n + 1):
                aug[r][c] -= factor * aug[col][c]
    return [aug[i][n] for i in range(n)]


def inverse_matrix(matrix: list[list[float]]) -> list[list[float]]:
    n = len(matrix)
    aug = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = col
        for r in range(col + 1, n):
            if abs(aug[r][col]) > abs(aug[pivot][col]):
                pivot = r
        if abs(aug[pivot][col]) < 1e-12:
            continue
        if pivot != col:
            aug[col], aug[pivot] = aug[pivot], aug[col]
        pivot_val = aug[col][col]
        for c in range(2 * n):
            aug[col][c] /= pivot_val
        for r in range(n):
            if r == col:
                continue
            factor = aug[r][col]
            if factor == 0:
                continue
            for c in range(2 * n):
                aug[r][c] -= factor * aug[col][c]
    return [row[n:] for row in aug]


def ols_fit(design: list[list[float]], y: list[float], names: list[str], ridge: float = 1e-8) -> dict[str, Any]:
    n = len(design)
    k = len(names)
    if n == 0 or k == 0:
        return {"nobs": 0, "coefficients": [], "r2": 0.0}

    xtx = [[0.0 for _ in range(k)] for _ in range(k)]
    xty = [0.0 for _ in range(k)]
    for row, yi in zip(design, y, strict=False):
        for i in range(k):
            xty[i] += row[i] * yi
            for j in range(k):
                xtx[i][j] += row[i] * row[j]
    for i in range(k):
        xtx[i][i] += ridge

    beta = solve_linear_system(xtx, xty)
    yhat = [sum(beta[i] * row[i] for i in range(k)) for row in design]
    y_mean = mean(y)
    sst = sum((yi - y_mean) ** 2 for yi in y)
    sse = sum((yi - yh) ** 2 for yi, yh in zip(y, yhat, strict=False))
    r2 = 1.0 - safe_div(sse, sst) if sst > 0 else 0.0

    sigma2 = safe_div(sse, max(n - k, 1))
    xtx_inv = inverse_matrix(xtx)
    se = [math.sqrt(max(sigma2 * xtx_inv[i][i], 0.0)) for i in range(k)]
    coefficients = []
    for i, name in enumerate(names):
        ci_low = beta[i] - 1.96 * se[i]
        ci_high = beta[i] + 1.96 * se[i]
        coefficients.append(
            {
                "name": name,
                "coef": beta[i],
                "stdErr": se[i],
                "tStat": safe_div(beta[i], se[i]),
                "ci95Low": ci_low,
                "ci95High": ci_high,
            }
        )

    return {
        "nobs": n,
        "k": k,
        "r2": r2,
        "coefficients": coefficients,
        "beta": beta,
        "coefNames": names,
    }


def bootstrap_diff_mean(a: list[float], b: list[float], rng: random.Random, rounds: int = 400) -> tuple[float, float]:
    if not a or not b:
        return (0.0, 0.0)
    diffs = []
    for _ in range(rounds):
        sa = [a[rng.randrange(len(a))] for _ in range(len(a))]
        sb = [b[rng.randrange(len(b))] for _ in range(len(b))]
        diffs.append(mean(sa) - mean(sb))
    diffs.sort()
    low_idx = max(int(rounds * 0.025) - 1, 0)
    high_idx = min(int(rounds * 0.975), rounds - 1)
    return (diffs[low_idx], diffs[high_idx])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build dashboard-data.json for GitHub Pages")
    parser.add_argument("--config", default="config/analysis-config.json")
    parser.add_argument("--input-dir", default=".")
    parser.add_argument("--output-dir", default="docs/data")
    return parser.parse_args()


def build_model_rows(
    area_rows: list[dict[str, Any]],
    small_party_codes: set[str],
    candidate_maps: dict[str, dict[int, dict[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    rows = []
    for area in area_rows:
        area_code = area.get("areaCode")
        party_total_votes = float(area.get("totals", {}).get("totalVotes", 0) or 0)
        constituency_total_votes = float(area.get("constituencyTotals", {}).get("totalVotes", 0) or 0)
        if party_total_votes <= 0 or constituency_total_votes <= 0:
            continue

        if candidate_maps and area_code in candidate_maps:
            candidates_by_no = candidate_maps[area_code]
        else:
            candidates_by_no = {
                c.get("candidateNo"): c
                for c in area.get("candidates", [])
                if isinstance(c.get("candidateNo"), int)
            }

        const_by_party = {e.get("partyCode"): e for e in area.get("constituencyPartyResults", [])}
        winner = next((e for e in area.get("constituencyPartyResults", []) if e.get("rank") == 1), None)
        winner_code = winner.get("partyCode") if winner else None

        turnout_rate = safe_div(float(area.get("totals", {}).get("goodVotes", 0) or 0), party_total_votes)
        bad_rate = safe_div(float(area.get("totals", {}).get("badVotes", 0) or 0), party_total_votes)
        no_rate = safe_div(float(area.get("totals", {}).get("noVotes", 0) or 0), party_total_votes)
        derived = area.get("derivedMetrics", {})

        for pr in area.get("partyResults", []):
            if pr.get("partyCode") not in small_party_codes:
                continue
            party_no = pr.get("partyNo")
            if not isinstance(party_no, int):
                continue
            candidate = candidates_by_no.get(party_no)
            if not candidate:
                continue
            source_code = candidate.get("candidatePartyCode")
            source_const = const_by_party.get(source_code, {})
            source_votes = float(source_const.get("voteTotal", 0) or 0)
            source_share = safe_div(source_votes, constituency_total_votes)
            small_share = safe_div(float(pr.get("votePercent", 0) or 0), 100.0)
            rows.append(
                {
                    "areaCode": area_code,
                    "areaName": area.get("areaName"),
                    "provinceCode": area.get("provinceCode"),
                    "provinceName": area.get("provinceName"),
                    "smallPartyCode": pr.get("partyCode"),
                    "smallPartyNo": pr.get("partyNo"),
                    "smallPartyName": pr.get("partyName"),
                    "smallPartyVotes": float(pr.get("voteTotal", 0) or 0),
                    "smallPartyShare": small_share,
                    "sourcePartyCode": source_code,
                    "sourcePartyNo": candidate.get("candidatePartyNo"),
                    "sourcePartyName": candidate.get("candidatePartyName"),
                    "sourceConstituencyVotes": source_votes,
                    "sourceConstituencyShare": source_share,
                    "sourcePartyWonArea": source_code == winner_code,
                    "isSuspicious": bool(derived.get("isSuspiciousAreaResidualTop10")),
                    "turnoutRate": turnout_rate,
                    "badRate": bad_rate,
                    "noRate": no_rate,
                }
            )
    return rows


def build_permuted_candidate_maps(area_rows: list[dict[str, Any]], rng: random.Random) -> dict[str, dict[int, dict[str, Any]]]:
    maps: dict[str, dict[int, dict[str, Any]]] = {}
    for area in area_rows:
        area_code = area.get("areaCode")
        candidates = [c for c in area.get("candidates", []) if isinstance(c.get("candidateNo"), int)]
        if not area_code or not candidates:
            continue
        numbers = [c["candidateNo"] for c in candidates]
        shuffled = numbers[:]
        rng.shuffle(shuffled)
        no_to_candidate: dict[int, dict[str, Any]] = {}
        for c, new_no in zip(candidates, shuffled, strict=False):
            no_to_candidate[new_no] = c
        maps[area_code] = no_to_candidate
    return maps


def simple_interaction_effect(rows: list[dict[str, Any]]) -> float:
    if not rows:
        return 0.0
    design = []
    y = []
    for r in rows:
        x = float(r.get("sourceConstituencyShare", 0) or 0)
        s = 1.0 if r.get("isSuspicious") else 0.0
        design.append([1.0, x, s, x * s])
        y.append(float(r.get("smallPartyShare", 0) or 0))
    fit = ols_fit(design, y, ["intercept", "x", "suspicious", "x_suspicious"])
    by_name = {c["name"]: c for c in fit.get("coefficients", [])}
    return float(by_name.get("x_suspicious", {}).get("coef", 0.0) or 0.0)


def main() -> int:
    args = parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    cfg = read_json(Path(args.config))
    small_min, small_max = cfg["small_party_range"]
    base_party_numbers = set(cfg["base_party_numbers"])

    common = read_json(input_dir / "common-data.json")
    parties_raw = read_json(input_dir / "party-data.json")["parties"]
    candidates_raw = read_json(input_dir / "candidate-data.json")["candidates"]
    summary_path = input_dir / "summary.json"
    summary = read_json(summary_path) if summary_path.exists() else None

    parties_by_code = {p["code"]: p for p in parties_raw}
    parties_by_no = {p["number"]: p for p in parties_raw}

    provinces_by_code = {p["code"]: p for p in common["provinces"]}
    areas_by_code = {a["code"]: a for a in common["areas"]}

    candidates_by_area: dict[str, list[dict[str, Any]]] = defaultdict(list)
    candidate_lookup: dict[tuple[str, int], dict[str, Any]] = {}

    for c in candidates_raw:
        area_code = c["areaCode"]
        party = parties_by_code.get(c["partyCode"], {})
        row = {
            "candidateCode": c.get("code"),
            "candidateNo": c.get("number"),
            "candidateName": f"{c.get('prefix', '')}{c.get('specialPrefix', '')}{c.get('firstName', '')} {c.get('lastName', '')}".strip(),
            "candidatePartyCode": c.get("partyCode"),
            "candidatePartyNo": party.get("number"),
            "candidatePartyName": party.get("name"),
        }
        candidates_by_area[area_code].append(row)
        no = c.get("number")
        if isinstance(no, int):
            candidate_lookup[(area_code, no)] = row

    area_files = sorted(glob.glob(str(input_dir / "area-candidates" / "AREA-*.json")))
    const_files = sorted(glob.glob(str(input_dir / "area-constituency" / "AREA-*.json")))
    const_payload_by_area: dict[str, dict[str, Any]] = {}
    constituency_vote_rows: list[dict[str, Any]] = []
    for fp in const_files:
        const_payload = read_json(Path(fp))
        area_code = const_payload.get("areaCode")
        if area_code:
            const_payload_by_area[area_code] = const_payload
            for e in const_payload.get("entries", []):
                party_code = e.get("partyCode")
                p = parties_by_code.get(party_code, {})
                constituency_vote_rows.append(
                    {
                        "areaCode": area_code,
                        "partyCode": party_code,
                        "partyNo": p.get("number"),
                        "partyName": p.get("name"),
                        "partyColor": p.get("colorPrimary"),
                        "voteTotal": e.get("voteTotal", 0) or 0,
                    }
                )

    area_rows: list[dict[str, Any]] = []
    vote_rows: list[dict[str, Any]] = []

    for fp in area_files:
        payload = read_json(Path(fp))
        area_code = payload["areaCode"]
        area_meta = areas_by_code.get(area_code, {})
        province_meta = provinces_by_code.get(area_meta.get("provinceCode"), {})

        party_results = []
        for e in payload.get("entries", []):
            p = parties_by_code.get(e["partyCode"], {})
            party_row = {
                "partyCode": e["partyCode"],
                "partyNo": p.get("number"),
                "partyName": p.get("name"),
                "partyColor": p.get("colorPrimary"),
                "voteTotal": e.get("voteTotal", 0),
                "votePercent": e.get("votePercent", 0),
                "rank": e.get("rank"),
            }
            party_results.append(party_row)
            vote_rows.append(
                {
                    "areaCode": area_code,
                    "provinceCode": area_meta.get("provinceCode"),
                    "provinceName": province_meta.get("name"),
                    **party_row,
                }
            )

        party_results.sort(key=lambda x: (x.get("rank") if x.get("rank") is not None else 9999, -(x.get("voteTotal") or 0)))

        const_payload = const_payload_by_area.get(area_code, {})
        area_rows.append(
            {
                "areaCode": area_code,
                "areaName": area_meta.get("name"),
                "areaNo": area_meta.get("number"),
                "provinceCode": area_meta.get("provinceCode"),
                "provinceName": province_meta.get("name"),
                "totals": {
                    "totalVotes": payload.get("totalVotes", 0),
                    "goodVotes": payload.get("goodVotes", 0),
                    "badVotes": payload.get("badVotes", 0),
                    "noVotes": payload.get("noVotes", 0),
                    "voteProgressPercent": payload.get("voteProgressPercent"),
                },
                "constituencyTotals": {
                    "totalVotes": const_payload.get("totalVotes", 0),
                    "goodVotes": const_payload.get("goodVotes", 0),
                    "badVotes": const_payload.get("badVotes", 0),
                    "noVotes": const_payload.get("noVotes", 0),
                    "voteProgressPercent": const_payload.get("voteProgressPercent"),
                },
                "constituencyPartyResults": sorted(
                    [
                        {
                            "partyCode": e.get("partyCode"),
                            "partyNo": parties_by_code.get(e.get("partyCode"), {}).get("number"),
                            "partyName": parties_by_code.get(e.get("partyCode"), {}).get("name"),
                            "partyColor": parties_by_code.get(e.get("partyCode"), {}).get("colorPrimary"),
                            "voteTotal": e.get("voteTotal", 0),
                            "votePercent": e.get("votePercent", 0),
                            "rank": e.get("rank"),
                        }
                        for e in const_payload.get("entries", [])
                    ],
                    key=lambda x: (x.get("rank") if x.get("rank") is not None else 9999, -(x.get("voteTotal") or 0)),
                ),
                "partyResults": party_results,
                "candidates": sorted(candidates_by_area.get(area_code, []), key=lambda x: x.get("candidateNo") or 9999),
            }
        )

    # Derived metrics for suspicious-area definition (Residual Top 10%)
    small_party_codes = {
        p.get("code")
        for p in parties_raw
        if isinstance(p.get("number"), int) and small_min <= int(p.get("number")) <= small_max
    }
    area_small_shares = []
    province_share_map: dict[str, list[float]] = defaultdict(list)
    for a in area_rows:
        small_votes = sum(
            float(pr.get("voteTotal", 0) or 0)
            for pr in a.get("partyResults", [])
            if pr.get("partyCode") in small_party_codes
        )
        total_votes = float(a.get("totals", {}).get("totalVotes", 0) or 0)
        share = safe_div(small_votes, total_votes)
        province_code = a.get("provinceCode") or "UNKNOWN"
        area_small_shares.append(share)
        province_share_map[province_code].append(share)
        a["derivedMetrics"] = {
            "smallPartyCombinedVotes": small_votes,
            "smallPartyCombinedShare": share,
            "smallPartyResidualScore": 0.0,
            "isSuspiciousAreaResidualTop10": False,
        }

    province_stats: dict[str, dict[str, float]] = {}
    low_info_provinces = []
    for p_code, shares in province_share_map.items():
        mu = mean(shares)
        sd = stddev(shares)
        province_stats[p_code] = {"mean": mu, "std": sd}
        if sd <= 1e-12:
            low_info_provinces.append(p_code)

    residuals = []
    for a in area_rows:
        p_code = a.get("provinceCode") or "UNKNOWN"
        share = float(a["derivedMetrics"]["smallPartyCombinedShare"])
        mu = province_stats.get(p_code, {}).get("mean", 0.0)
        sd = province_stats.get(p_code, {}).get("std", 0.0)
        z = safe_div(share - mu, sd) if sd > 1e-12 else 0.0
        a["derivedMetrics"]["smallPartyResidualScore"] = z
        residuals.append(z)

    suspicious_threshold = quantile(residuals, 0.9)
    suspicious_areas = 0
    for a in area_rows:
        is_susp = float(a["derivedMetrics"]["smallPartyResidualScore"]) >= suspicious_threshold
        a["derivedMetrics"]["isSuspiciousAreaResidualTop10"] = is_susp
        suspicious_areas += 1 if is_susp else 0

    # Model rows for FE + within-province + party comparisons
    model_rows = build_model_rows(area_rows, small_party_codes)

    # Evidence A: within-province suspicious vs control comparison
    provinces_comp = []
    suspicious_shares = []
    control_shares = []
    suspicious_win_proxy = []
    control_win_proxy = []
    by_province_areas: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for a in area_rows:
        by_province_areas[a.get("provinceCode") or "UNKNOWN"].append(a)
    for p_code, areas in by_province_areas.items():
        s_rows = [a for a in areas if a.get("derivedMetrics", {}).get("isSuspiciousAreaResidualTop10")]
        c_rows = [a for a in areas if not a.get("derivedMetrics", {}).get("isSuspiciousAreaResidualTop10")]
        s_shares = [float(a.get("derivedMetrics", {}).get("smallPartyCombinedShare", 0.0) or 0.0) for a in s_rows]
        c_shares = [float(a.get("derivedMetrics", {}).get("smallPartyCombinedShare", 0.0) or 0.0) for a in c_rows]
        s_wins = [
            safe_div(
                float((next((x for x in a.get("constituencyPartyResults", []) if x.get("rank") == 1), {}) or {}).get("votePercent", 0) or 0),
                100.0,
            )
            for a in s_rows
        ]
        c_wins = [
            safe_div(
                float((next((x for x in a.get("constituencyPartyResults", []) if x.get("rank") == 1), {}) or {}).get("votePercent", 0) or 0),
                100.0,
            )
            for a in c_rows
        ]
        suspicious_shares.extend(s_shares)
        control_shares.extend(c_shares)
        suspicious_win_proxy.extend(s_wins)
        control_win_proxy.extend(c_wins)
        provinces_comp.append(
            {
                "provinceCode": p_code,
                "provinceName": (provinces_by_code.get(p_code) or {}).get("name"),
                "suspiciousCount": len(s_rows),
                "controlCount": len(c_rows),
                "meanSmallPartyShareSuspicious": mean(s_shares),
                "meanSmallPartyShareControl": mean(c_shares),
                "diffSmallPartyShare": mean(s_shares) - mean(c_shares),
                "meanWinnerShareSuspicious": mean(s_wins),
                "meanWinnerShareControl": mean(c_wins),
                "diffWinnerShare": mean(s_wins) - mean(c_wins),
            }
        )
    provinces_comp.sort(key=lambda x: (x.get("diffSmallPartyShare", 0), x.get("suspiciousCount", 0)), reverse=True)
    ci_diff = bootstrap_diff_mean(suspicious_shares, control_shares, random.Random(20260209), rounds=500)
    ci_win = bootstrap_diff_mean(suspicious_win_proxy, control_win_proxy, random.Random(20260210), rounds=500)

    # Evidence B: province + source-party fixed effects (summary only)
    province_levels = sorted(
        {
            r.get("provinceCode")
            for r in model_rows
            if r.get("provinceCode") and (r.get("provinceCode") not in low_info_provinces)
        }
    )
    source_party_levels = sorted({r.get("sourcePartyCode") for r in model_rows if r.get("sourcePartyCode")})
    province_base = province_levels[0] if province_levels else None
    source_party_base = source_party_levels[0] if source_party_levels else None
    fe_design = []
    fe_y = []
    fe_names = ["intercept", "source_share", "suspicious", "source_share_x_suspicious", "turnout_rate", "bad_rate", "no_rate"]
    for p_code in province_levels[1:]:
        fe_names.append(f"fe_province_{p_code}")
    for s_code in source_party_levels[1:]:
        fe_names.append(f"fe_source_party_{s_code}")

    for r in model_rows:
        if r.get("provinceCode") in low_info_provinces:
            continue
        row = [
            1.0,
            float(r.get("sourceConstituencyShare", 0.0) or 0.0),
            1.0 if r.get("isSuspicious") else 0.0,
            float(r.get("sourceConstituencyShare", 0.0) or 0.0) * (1.0 if r.get("isSuspicious") else 0.0),
            float(r.get("turnoutRate", 0.0) or 0.0),
            float(r.get("badRate", 0.0) or 0.0),
            float(r.get("noRate", 0.0) or 0.0),
        ]
        for p_code in province_levels[1:]:
            row.append(1.0 if r.get("provinceCode") == p_code else 0.0)
        for s_code in source_party_levels[1:]:
            row.append(1.0 if r.get("sourcePartyCode") == s_code else 0.0)
        fe_design.append(row)
        fe_y.append(float(r.get("smallPartyShare", 0.0) or 0.0))
    fe_fit = ols_fit(fe_design, fe_y, fe_names)
    fe_coef_map = {c["name"]: c for c in fe_fit.get("coefficients", [])}

    # Evidence C: placebo / permutation for interaction effect
    placebo_rounds = 1000
    placebo_seed = 20260209
    real_effect = simple_interaction_effect(model_rows)
    placebo_effects = []
    for i in range(placebo_rounds):
        rng = random.Random(placebo_seed + i)
        candidate_maps = build_permuted_candidate_maps(area_rows, rng)
        placebo_rows = build_model_rows(area_rows, small_party_codes, candidate_maps)
        placebo_effects.append(simple_interaction_effect(placebo_rows))
    abs_real = abs(real_effect)
    empirical_p = safe_div(sum(1 for x in placebo_effects if abs(x) >= abs_real), len(placebo_effects))
    placebo_mean = mean(placebo_effects)
    placebo_std = stddev(placebo_effects)

    # Evidence D: People Party vs others in suspicious areas
    suspicious_model_rows = [r for r in model_rows if r.get("isSuspicious")]
    agg_source: dict[str, dict[str, Any]] = {}
    for r in suspicious_model_rows:
        code = r.get("sourcePartyCode") or "UNKNOWN"
        if code not in agg_source:
            agg_source[code] = {
                "sourcePartyCode": code,
                "sourcePartyNo": r.get("sourcePartyNo"),
                "sourcePartyName": r.get("sourcePartyName"),
                "relatedVotes": 0.0,
                "sourceConstituencyVotesInMatchedAreas": 0.0,
                "rows": 0,
                "areaSet": set(),
                "winsInSuspiciousAreas": set(),
                "smallShareSum": 0.0,
            }
        x = agg_source[code]
        x["relatedVotes"] += float(r.get("smallPartyVotes", 0) or 0)
        x["sourceConstituencyVotesInMatchedAreas"] += float(r.get("sourceConstituencyVotes", 0) or 0)
        x["rows"] += 1
        x["areaSet"].add(r.get("areaCode"))
        if r.get("sourcePartyWonArea"):
            x["winsInSuspiciousAreas"].add(r.get("areaCode"))
        x["smallShareSum"] += float(r.get("smallPartyShare", 0) or 0)
    party_rows = []
    for v in agg_source.values():
        party_rows.append(
            {
                "sourcePartyCode": v["sourcePartyCode"],
                "sourcePartyNo": v["sourcePartyNo"],
                "sourcePartyName": v["sourcePartyName"],
                "relatedVotes": v["relatedVotes"],
                "sourceConstituencyVotesInMatchedAreas": v["sourceConstituencyVotesInMatchedAreas"],
                "normalizedEffect": safe_div(v["relatedVotes"], v["sourceConstituencyVotesInMatchedAreas"]),
                "rows": v["rows"],
                "areaCount": len(v["areaSet"]),
                "winsInSuspiciousAreas": len(v["winsInSuspiciousAreas"]),
                "meanSmallPartyShare": safe_div(v["smallShareSum"], v["rows"]),
            }
        )
    party_rows.sort(key=lambda x: x.get("normalizedEffect", 0), reverse=True)
    for idx, r in enumerate(party_rows, start=1):
        r["rankByNormalizedEffect"] = idx
    people_party_row = next(
        (
            r
            for r in party_rows
            if "ประชาชน" in str(r.get("sourcePartyName", ""))
            or str(r.get("sourcePartyCode", "")) == "PARTY-0012"
        ),
        None,
    )

    # Overview aggregates
    national_totals = {"totalVotes": 0, "goodVotes": 0, "badVotes": 0, "noVotes": 0}
    constituency_national_totals = {"totalVotes": 0, "goodVotes": 0, "badVotes": 0, "noVotes": 0}
    province_totals_map: dict[str, dict[str, Any]] = {}
    party_totals_map: dict[str, dict[str, Any]] = {}

    for a in area_rows:
        t = a["totals"]
        national_totals["totalVotes"] += t["totalVotes"]
        national_totals["goodVotes"] += t["goodVotes"]
        national_totals["badVotes"] += t["badVotes"]
        national_totals["noVotes"] += t["noVotes"]
        ct = a.get("constituencyTotals") or {}
        constituency_national_totals["totalVotes"] += ct.get("totalVotes", 0) or 0
        constituency_national_totals["goodVotes"] += ct.get("goodVotes", 0) or 0
        constituency_national_totals["badVotes"] += ct.get("badVotes", 0) or 0
        constituency_national_totals["noVotes"] += ct.get("noVotes", 0) or 0

        p_code = a["provinceCode"] or "UNKNOWN"
        if p_code not in province_totals_map:
            province_totals_map[p_code] = {
                "provinceCode": p_code,
                "provinceName": a.get("provinceName"),
                "areaCount": 0,
                "totalVotes": 0,
                "goodVotes": 0,
                "badVotes": 0,
                "noVotes": 0,
            }
        province_totals_map[p_code]["areaCount"] += 1
        province_totals_map[p_code]["totalVotes"] += t["totalVotes"]
        province_totals_map[p_code]["goodVotes"] += t["goodVotes"]
        province_totals_map[p_code]["badVotes"] += t["badVotes"]
        province_totals_map[p_code]["noVotes"] += t["noVotes"]

    for row in vote_rows:
        p_code = row["partyCode"]
        if p_code not in party_totals_map:
            party_totals_map[p_code] = {
                "partyCode": p_code,
                "partyNo": row.get("partyNo"),
                "partyName": row.get("partyName"),
                "partyColor": row.get("partyColor"),
                "voteTotal": 0,
            }
        party_totals_map[p_code]["voteTotal"] += row.get("voteTotal", 0)

    party_totals = sorted(party_totals_map.values(), key=lambda x: x["voteTotal"], reverse=True)
    all_party_votes = sum(x["voteTotal"] for x in party_totals) or 1
    for idx, row in enumerate(party_totals, start=1):
        row["rank"] = idx
        row["share"] = row["voteTotal"] / all_party_votes

    constituency_party_totals_map: dict[str, dict[str, Any]] = {}
    for row in constituency_vote_rows:
        p_code = row["partyCode"]
        if p_code not in constituency_party_totals_map:
            constituency_party_totals_map[p_code] = {
                "partyCode": p_code,
                "partyNo": row.get("partyNo"),
                "partyName": row.get("partyName"),
                "partyColor": row.get("partyColor"),
                "voteTotal": 0,
            }
        constituency_party_totals_map[p_code]["voteTotal"] += row.get("voteTotal", 0)

    constituency_party_totals = sorted(constituency_party_totals_map.values(), key=lambda x: x["voteTotal"], reverse=True)
    all_const_votes = sum(x["voteTotal"] for x in constituency_party_totals) or 1
    for idx, row in enumerate(constituency_party_totals, start=1):
        row["rank"] = idx
        row["share"] = row["voteTotal"] / all_const_votes

    province_totals = sorted(province_totals_map.values(), key=lambda x: x["totalVotes"], reverse=True)

    # Alignment rows
    alignment_rows = []
    for row in vote_rows:
        party_no = row.get("partyNo")
        if not isinstance(party_no, int) or party_no < small_min or party_no > small_max:
            continue

        area_code = row["areaCode"]
        candidate = candidate_lookup.get((area_code, party_no))

        matched = candidate is not None
        candidate_party_no = candidate.get("candidatePartyNo") if candidate else None
        is_base_match = matched and candidate_party_no in base_party_numbers

        alignment_rows.append(
            {
                "areaCode": area_code,
                "areaName": areas_by_code.get(area_code, {}).get("name"),
                "provinceCode": row.get("provinceCode"),
                "provinceName": row.get("provinceName"),
                "smallPartyCode": row.get("partyCode"),
                "smallPartyNo": party_no,
                "smallPartyName": row.get("partyName"),
                "smallPartyVotes": row.get("voteTotal", 0),
                "smallPartyVotePercent": row.get("votePercent", 0),
                "candidateNo": party_no,
                "matched": matched,
                "candidatePartyCode": candidate.get("candidatePartyCode") if candidate else None,
                "candidatePartyNo": candidate_party_no,
                "candidatePartyName": candidate.get("candidatePartyName") if candidate else None,
                "candidateName": candidate.get("candidateName") if candidate else None,
                "isBasePartyMatch": is_base_match,
            }
        )

    base_filtered = [r for r in alignment_rows if r["isBasePartyMatch"]]

    by_base_party_map: dict[str, dict[str, Any]] = {}
    for r in base_filtered:
        k = r["candidatePartyCode"]
        if k not in by_base_party_map:
            by_base_party_map[k] = {
                "candidatePartyCode": r["candidatePartyCode"],
                "candidatePartyNo": r["candidatePartyNo"],
                "candidatePartyName": r["candidatePartyName"],
                "rows": 0,
                "totalProxyVotes": 0,
                "distinctAreas": set(),
            }
        by_base_party_map[k]["rows"] += 1
        by_base_party_map[k]["totalProxyVotes"] += r["smallPartyVotes"]
        by_base_party_map[k]["distinctAreas"].add(r["areaCode"])

    by_base_party = []
    for row in by_base_party_map.values():
        by_base_party.append(
            {
                "candidatePartyCode": row["candidatePartyCode"],
                "candidatePartyNo": row["candidatePartyNo"],
                "candidatePartyName": row["candidatePartyName"],
                "rows": row["rows"],
                "totalProxyVotes": row["totalProxyVotes"],
                "areaCount": len(row["distinctAreas"]),
            }
        )
    by_base_party.sort(key=lambda x: x["totalProxyVotes"], reverse=True)

    # Outliers by percentile
    outliers = {}
    base_votes = [r["smallPartyVotes"] for r in base_filtered]
    for p in cfg["outlier_percentiles"]:
        threshold = quantile(base_votes, p)
        selected = [r for r in base_filtered if r["smallPartyVotes"] >= threshold]
        selected.sort(key=lambda x: x["smallPartyVotes"], reverse=True)
        outliers[str(p)] = {
            "percentile": p,
            "threshold": threshold,
            "rowCount": len(selected),
            "rows": selected,
        }

    unmatched_count = sum(1 for r in alignment_rows if not r["matched"])

    # Consistency checks against summary.json (if present)
    consistency = {}
    if summary:
        party_list_stats = summary.get("statisticsPartyList", {}).get("voteBreakdownByType", {})
        consistency["national_vs_summary_statisticsPartyList"] = {
            "total_diff": national_totals["totalVotes"] - summary.get("statisticsPartyList", {}).get("total", 0),
            "good_diff": national_totals["goodVotes"] - party_list_stats.get("goodVoteTotal", 0),
            "bad_diff": national_totals["badVotes"] - party_list_stats.get("badVoteTotal", 0),
            "no_diff": national_totals["noVotes"] - party_list_stats.get("noVoteTotal", 0),
        }

        sum_data = {x["partyCode"]: x.get("partyListVotes", 0) for x in summary.get("data", [])}
        mismatches = []
        for p in party_totals:
            expected = sum_data.get(p["partyCode"], 0)
            if expected != p["voteTotal"]:
                mismatches.append(
                    {
                        "partyCode": p["partyCode"],
                        "partyName": p["partyName"],
                        "summaryPartyListVotes": expected,
                        "actual": p["voteTotal"],
                        "diff": p["voteTotal"] - expected,
                    }
                )
        consistency["party_totals_vs_summary_data_partyListVotes"] = {
            "mismatchCount": len(mismatches),
            "mismatches": mismatches,
        }

    dashboard_data = {
        "config_used": cfg,
        "overview": {
            "national_totals": national_totals,
            "constituency_national_totals": constituency_national_totals,
            "party_totals": party_totals,
            "constituency_party_totals": constituency_party_totals,
            "province_totals": province_totals,
            "consistency_checks": consistency,
        },
        "areas": area_rows,
        "alignment": {
            "rows": alignment_rows,
            "summary": {
                "rows": len(alignment_rows),
                "matchedRows": len(alignment_rows) - unmatched_count,
                "matchRate": (len(alignment_rows) - unmatched_count) / max(len(alignment_rows), 1),
                "baseFilteredRows": len(base_filtered),
                "baseFilteredProxyVotes": sum(r["smallPartyVotes"] for r in base_filtered),
                "unmatchedRows": unmatched_count,
            },
            "summary_by_base_party": by_base_party,
            "outliers": outliers,
        },
        "analysisEvidence": {
            "definition": {
                "smallPartyRangeFromConfig": [small_min, small_max],
                "suspiciousRule": "Residual Top 10% by province-normalized small-party combined share",
                "placeboRounds": placebo_rounds,
                "placeboSeed": placebo_seed,
            },
            "withinProvinceComparisons": {
                "residualTop10Threshold": suspicious_threshold,
                "suspiciousAreaCount": suspicious_areas,
                "controlAreaCount": len(area_rows) - suspicious_areas,
                "overall": {
                    "meanSmallPartyShareSuspicious": mean(suspicious_shares),
                    "meanSmallPartyShareControl": mean(control_shares),
                    "diffSmallPartyShare": mean(suspicious_shares) - mean(control_shares),
                    "diffSmallPartyShareBootstrapCi95": [ci_diff[0], ci_diff[1]],
                    "meanWinnerShareSuspicious": mean(suspicious_win_proxy),
                    "meanWinnerShareControl": mean(control_win_proxy),
                    "diffWinnerShare": mean(suspicious_win_proxy) - mean(control_win_proxy),
                    "diffWinnerShareBootstrapCi95": [ci_win[0], ci_win[1]],
                },
                "byProvince": provinces_comp,
                "lowInformationProvinces": low_info_provinces,
            },
            "fixedEffectsResults": {
                "model": "small_party_share ~ source_share + suspicious + source_share*suspicious + turnout + bad_rate + no_rate + province FE + source party FE",
                "nobs": fe_fit.get("nobs", 0),
                "r2": fe_fit.get("r2", 0.0),
                "baseProvinceCode": province_base,
                "baseSourcePartyCode": source_party_base,
                "keyCoefficients": {
                    "source_share": fe_coef_map.get("source_share"),
                    "suspicious": fe_coef_map.get("suspicious"),
                    "source_share_x_suspicious": fe_coef_map.get("source_share_x_suspicious"),
                },
                "allCoefficients": fe_fit.get("coefficients", []),
            },
            "placeboResults": {
                "realInteractionEffect": real_effect,
                "placeboMean": placebo_mean,
                "placeboStd": placebo_std,
                "empiricalPValueTwoSided": empirical_p,
                "placeboEffects": placebo_effects,
                "placeboQuantiles": {
                    "q01": quantile(placebo_effects, 0.01),
                    "q05": quantile(placebo_effects, 0.05),
                    "q50": quantile(placebo_effects, 0.50),
                    "q95": quantile(placebo_effects, 0.95),
                    "q99": quantile(placebo_effects, 0.99),
                },
            },
            "peoplePartyComparisons": {
                "inSuspiciousAreasOnly": True,
                "rows": party_rows,
                "peopleParty": people_party_row,
                "suspiciousRows": len(suspicious_model_rows),
                "suspiciousAreas": len({r.get("areaCode") for r in suspicious_model_rows}),
            },
        },
        "dimensions": {
            "parties": [
                {
                    "partyCode": p.get("code"),
                    "partyNo": p.get("number"),
                    "partyName": p.get("name"),
                    "partyColor": p.get("colorPrimary"),
                }
                for p in sorted(parties_raw, key=lambda x: x.get("number", 9999))
            ],
            "provinces": [
                {
                    "provinceCode": p.get("code"),
                    "provinceName": p.get("name"),
                }
                for p in common.get("provinces", [])
            ],
            "areas": [
                {
                    "areaCode": a.get("code"),
                    "areaName": a.get("name"),
                    "areaNo": a.get("number"),
                    "provinceCode": a.get("provinceCode"),
                }
                for a in common.get("areas", [])
            ],
        },
    }

    json_text = json.dumps(dashboard_data, ensure_ascii=False, separators=(",", ":"))
    sha = hashlib.sha256(json_text.encode("utf-8")).hexdigest()

    metadata = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "input": {
            "areaFileCount": len(area_files),
            "areaCount": len(area_rows),
            "partyCount": len(parties_raw),
            "candidateCount": len(candidates_raw),
        },
        "checks": {
            "areaCountIs400": len(area_rows) == 400,
            "nationalConsistency": consistency.get("national_vs_summary_statisticsPartyList"),
            "partyMismatchCount": consistency.get("party_totals_vs_summary_data_partyListVotes", {}).get("mismatchCount"),
        },
        "dataSha256": sha,
    }

    (output_dir / "dashboard-data.json").write_text(json.dumps(dashboard_data, ensure_ascii=False), encoding="utf-8")
    (output_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"wrote {(output_dir / 'dashboard-data.json')}")
    print(f"wrote {(output_dir / 'metadata.json')}")
    print(f"areas={len(area_rows)} alignment_rows={len(alignment_rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
