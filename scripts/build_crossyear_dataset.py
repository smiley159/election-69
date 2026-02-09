#!/usr/bin/env python3
"""Build cross-year mapped dataset between election 66 and 69."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_text(s: str | None) -> str:
    return "" if s is None else re.sub(r"\s+", "", str(s).strip())


def quantile(values, q):
    if not values:
        return 0.0
    arr = sorted(values)
    if q <= 0:
        return arr[0]
    if q >= 1:
        return arr[-1]
    pos = (len(arr) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(arr) - 1)
    frac = pos - lo
    return arr[lo] * (1 - frac) + arr[hi] * frac


def read_crosswalk(path: Path):
    rows = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8", newline="") as f:
        rd = csv.DictReader(f)
        for r in rd:
            rows.append(r)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description="Build cross-year mapped dataset")
    ap.add_argument("--in66", default="data/normalized/election66_normalized.json")
    ap.add_argument("--in69", default="data/normalized/election69_normalized.json")
    ap.add_argument("--parties", default="party-data.json")
    ap.add_argument("--crosswalk", default="config/party-crosswalk-66-69.csv")
    ap.add_argument("--settings", default="config/research-settings.json")
    ap.add_argument("--out-features", default="data/research/crossyear_features.json")
    ap.add_argument("--out-summary", default="data/research/crossyear_summary.json")
    ap.add_argument("--out-quality", default="data/research/mapping_quality_report.json")
    args = ap.parse_args()

    n66 = load_json(Path(args.in66))
    n69 = load_json(Path(args.in69))
    settings = load_json(Path(args.settings))
    parties69 = load_json(Path(args.parties))["parties"]
    crosswalk = read_crosswalk(Path(args.crosswalk))

    party69_by_code = {p["code"]: p for p in parties69}
    party69_by_name_norm = {normalize_text(p.get("name")): p for p in parties69 if p.get("name")}

    crosswalk_by_name = {}
    for r in crosswalk:
        key = normalize_text(r.get("party66_name"))
        if key:
            crosswalk_by_name[key] = r

    rows66 = n66["rows"]
    rows69 = n69["rows"]

    district66 = {r["district_key"] for r in rows66 if r.get("district_key")}
    district69 = {r["district_key"] for r in rows69 if r.get("district_key")}

    mapped66 = []
    party_match_counts = Counter()
    unmapped_party_counter = Counter()

    for r in rows66:
        rr = dict(r)
        pnorm = normalize_text(r.get("party_name_norm") or r.get("party_name_raw"))

        party_key_69 = None
        party_match_conf = "unmapped"
        mapping_notes = ""

        if pnorm in party69_by_name_norm:
            p = party69_by_name_norm[pnorm]
            party_key_69 = p["code"]
            party_match_conf = "exact"
            mapping_notes = "name_exact"
        elif pnorm in crosswalk_by_name:
            m = crosswalk_by_name[pnorm]
            code = m.get("party69_code")
            if code and code in party69_by_code:
                party_key_69 = code
                party_match_conf = "manual"
                mapping_notes = m.get("notes") or m.get("mapping_type") or "crosswalk"

        if party_key_69 is None:
            unmapped_party_counter[r.get("party_name_raw") or ""] += 1

        district_conf = "high" if rr.get("district_key") in district69 else "low"

        rr["party_key_69"] = party_key_69
        rr["party_match_confidence"] = party_match_conf
        rr["district_match_confidence"] = district_conf
        rr["mapping_notes"] = mapping_notes
        mapped66.append(rr)
        party_match_counts[party_match_conf] += 1

    rows69_mapped = []
    for r in rows69:
        rr = dict(r)
        rr["party_match_confidence"] = "exact"
        rr["district_match_confidence"] = "high" if rr.get("district_key") in district66 else "medium"
        rows69_mapped.append(rr)

    # index year69 by district+party
    idx69 = {(r.get("district_key"), r.get("party_key_69")): r for r in rows69_mapped if r.get("district_key") and r.get("party_key_69")}

    comparative_rows = []
    for r in mapped66:
        if r.get("district_match_confidence") == "low":
            continue
        if r.get("party_match_confidence") == "unmapped":
            continue
        key = (r.get("district_key"), r.get("party_key_69"))
        r69 = idx69.get(key)
        if not r69:
            continue
        comparative_rows.append(
            {
                "district_key": r.get("district_key"),
                "province_name_norm": r.get("province_name_norm"),
                "district_no": r.get("district_no"),
                "party_key_69": r.get("party_key_69"),
                "party_name_66": r.get("party_name_raw"),
                "party_name_69": r69.get("party_name_raw"),
                "gap_raw_66": r.get("gap_raw"),
                "gap_raw_69": r69.get("gap_raw"),
                "delta_gap_raw": (r69.get("gap_raw") or 0) - (r.get("gap_raw") or 0),
                "constituency_share_66": r.get("constituency_share"),
                "constituency_share_69": r69.get("constituency_share"),
                "partylist_share_66": r.get("partylist_share"),
                "partylist_share_69": r69.get("partylist_share"),
            }
        )

    # Winner rows for targeting blocks
    winners66 = [r for r in mapped66 if r.get("constituency_rank") == 1]
    winners69 = [r for r in rows69_mapped if r.get("constituency_rank") == 1]

    # close-seat proxy from year66 margins
    rows66_by_d = defaultdict(list)
    for r in mapped66:
        dk = r.get("district_key")
        if dk:
            rows66_by_d[dk].append(r)

    close_margin = {}
    for dk, rs in rows66_by_d.items():
        ordered = sorted(rs, key=lambda x: (x.get("constituency_rank") if x.get("constituency_rank") is not None else 9999))
        if len(ordered) >= 2 and ordered[0].get("constituency_share") is not None and ordered[1].get("constituency_share") is not None:
            close_margin[dk] = (ordered[0]["constituency_share"] - ordered[1]["constituency_share"])

    margins = list(close_margin.values())
    close_thr = quantile(margins, 0.3) if margins else 0.0

    winner69_gap = []
    for w in winners69:
        winner69_gap.append(
            {
                "district_key": w.get("district_key"),
                "province_name_norm": w.get("province_name_norm"),
                "district_no": w.get("district_no"),
                "winner_party_69": w.get("party_name_raw"),
                "winner_party_69_code": w.get("party_key_69"),
                "winner_gap_69": w.get("gap_raw"),
                "was_win66_same_party": any(
                    x.get("district_key") == w.get("district_key") and x.get("party_key_69") == w.get("party_key_69") and x.get("constituency_rank") == 1
                    for x in winners66
                ),
                "close_margin_66": close_margin.get(w.get("district_key")),
                "is_close_seat_66": (close_margin.get(w.get("district_key")) is not None and close_margin.get(w.get("district_key")) <= close_thr),
            }
        )

    # party comparative summary
    by_party = defaultdict(lambda: {"party_key_69": None, "party_name_69": None, "rows": 0, "gap66_sum": 0.0, "gap69_sum": 0.0})
    for r in comparative_rows:
        d = by_party[r["party_key_69"]]
        d["party_key_69"] = r["party_key_69"]
        d["party_name_69"] = r["party_name_69"]
        d["rows"] += 1
        d["gap66_sum"] += r["gap_raw_66"] or 0.0
        d["gap69_sum"] += r["gap_raw_69"] or 0.0

    party_comp = []
    for d in by_party.values():
        rows = d["rows"] or 1
        g66 = d["gap66_sum"] / rows
        g69 = d["gap69_sum"] / rows
        party_comp.append(
            {
                "party_key_69": d["party_key_69"],
                "party_name_69": d["party_name_69"],
                "rows": d["rows"],
                "mean_gap_66": g66,
                "mean_gap_69": g69,
                "delta_gap": g69 - g66,
            }
        )
    party_comp.sort(key=lambda x: x["delta_gap"], reverse=True)

    features = {
        "rows_66": mapped66,
        "rows_69": rows69_mapped,
        "comparative_rows": comparative_rows,
        "winner_rows_69": winner69_gap,
    }

    summary = {
        "coverage": {
            "district_66_count": len(district66),
            "district_69_count": len(district69),
            "district_overlap_count": len(district66 & district69),
            "district_overlap_ratio_vs69": (len(district66 & district69) / len(district69)) if district69 else 0.0,
            "party_match_counts_66": dict(party_match_counts),
            "party_match_ratio_66": {k: (v / len(mapped66)) if mapped66 else 0.0 for k, v in party_match_counts.items()},
        },
        "counts": {
            "rows66": len(mapped66),
            "rows69": len(rows69_mapped),
            "comparative_rows": len(comparative_rows),
            "winner_rows_69": len(winner69_gap),
        },
        "thresholds": {
            "close_margin_66_p30": close_thr,
            "anomaly_quantile": settings.get("anomaly_quantile", 0.97),
        },
        "party_comparative_summary": party_comp[:120],
        "winner_gap_watchlist_69": sorted(winner69_gap, key=lambda x: (x.get("winner_gap_69") or 0.0), reverse=True)[: settings.get("top_watchlist_limit", 200)],
    }

    quality = {
        "unmapped_party66_top": [{"party_name_66": k, "rows": v} for k, v in unmapped_party_counter.most_common(200)],
        "district_low_confidence_rows_66": sum(1 for r in mapped66 if r.get("district_match_confidence") == "low"),
        "district_low_confidence_ratio_66": (
            sum(1 for r in mapped66 if r.get("district_match_confidence") == "low") / len(mapped66)
            if mapped66
            else 0.0
        ),
        "notes": [
            "district mapping uses province_name_norm + district_no",
            "party mapping priority: exact name -> crosswalk -> unmapped",
            "comparative rows include only mapped district+party",
        ],
    }

    Path(args.out_features).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_summary).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_quality).parent.mkdir(parents=True, exist_ok=True)

    Path(args.out_features).write_text(json.dumps(features, ensure_ascii=False), encoding="utf-8")
    Path(args.out_summary).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    Path(args.out_quality).write_text(json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"wrote {args.out_features}")
    print(f"wrote {args.out_summary}")
    print(f"wrote {args.out_quality}")
    print(f"comparative_rows={len(comparative_rows)} district_overlap={len(district66 & district69)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
