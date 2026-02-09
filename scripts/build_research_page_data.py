#!/usr/bin/env python3
"""Build sectioned JSON files for single-page research dashboard."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from collections import defaultdict
from pathlib import Path


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


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


def histogram(vals, bins=40):
    if not vals:
        return []
    mn, mx = min(vals), max(vals)
    if mx <= mn:
        return [{"bin_from": mn, "bin_to": mx, "count": len(vals)}]
    w = (mx - mn) / bins
    hist = [{"bin_from": mn + i * w, "bin_to": mn + (i + 1) * w, "count": 0} for i in range(bins)]
    for v in vals:
        idx = int((v - mn) / w)
        if idx >= bins:
            idx = bins - 1
        hist[idx]["count"] += 1
    return hist


def main() -> int:
    ap = argparse.ArgumentParser(description="Build section JSON for research page")
    ap.add_argument("--input-dir", default=".")
    ap.add_argument("--out-dir", default="docs/data/research")
    args = ap.parse_args()

    input_dir = Path(args.input_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    hypothesis = (input_dir / "hypothesis.md").read_text(encoding="utf-8") if (input_dir / "hypothesis.md").exists() else ""

    dash = load_json(input_dir / "docs/data/dashboard-data.json")
    summary69 = load_json(input_dir / "analysis_summary.json")
    tests69 = load_json(input_dir / "hypothesis_tests.json")
    cross_summary = load_json(input_dir / "data/research/crossyear_summary.json")
    cross_features = load_json(input_dir / "data/research/crossyear_features.json")
    cross_quality = load_json(input_dir / "data/research/mapping_quality_report.json")

    rows66 = cross_features.get("rows_66", [])
    rows69 = cross_features.get("rows_69", [])
    comp = cross_features.get("comparative_rows", [])

    # SECTION: overview
    over = dash.get("overview", {})
    party_meta_by_code = {}
    for p in over.get("party_totals", []):
        code = p.get("partyCode")
        if not code:
            continue
        party_meta_by_code[code] = {"party_name": p.get("partyName"), "party_no": p.get("partyNo")}
    section_overview = {
        "title": "ภาพรวมข้อมูลและผลรวมคะแนน",
        "hypothesis_markdown": hypothesis,
        "national_totals_partylist_69": over.get("national_totals"),
        "province_totals_partylist_69": over.get("province_totals", []),
        "top_party_totals_partylist_69": over.get("party_totals", [])[:30],
        "coverage": cross_summary.get("coverage", {}),
        "counts": {
            "rows66": len(rows66),
            "rows69": len(rows69),
            "comparative_rows": len(comp),
            "areas69": summary69.get("counts", {}).get("areas"),
        },
    }

    # SECTION: gap
    g66 = [r.get("gap_raw") for r in rows66 if isinstance(r.get("gap_raw"), (int, float))]
    g69 = [r.get("gap_raw") for r in rows69 if isinstance(r.get("gap_raw"), (int, float))]

    # by party mean gap 69
    by_party_69 = defaultdict(lambda: {"party_code": None, "party_name": None, "party_no": None, "rows": 0, "sum_gap": 0.0})
    for r in rows69:
        code = r.get("party_key_69")
        if not code:
            continue
        d = by_party_69[code]
        d["party_code"] = code
        d["party_name"] = r.get("party_name_raw")
        d["party_no"] = r.get("party_no_raw")
        d["rows"] += 1
        d["sum_gap"] += r.get("gap_raw") or 0.0

    party_gap_69 = []
    for d in by_party_69.values():
        party_gap_69.append({
            "party_code": d["party_code"],
            "party_name": d["party_name"],
            "party_no": d["party_no"],
            "rows": d["rows"],
            "mean_gap_raw_69": d["sum_gap"] / d["rows"] if d["rows"] else 0.0,
        })
    party_gap_69.sort(key=lambda x: x["mean_gap_raw_69"], reverse=True)

    winner_gap_watchlist = []
    for w in summary69.get("winner_gap_watchlist", []):
        x = dict(w)
        meta = party_meta_by_code.get(w.get("winner_party_code"), {})
        x["winner_party_name"] = meta.get("party_name")
        x["winner_party_no"] = meta.get("party_no")
        winner_gap_watchlist.append(x)

    section_gap = {
        "title": "ผลวิเคราะห์ Gap: แบ่งเขตเทียบบัญชีรายชื่อ",
        "gap_distribution_66": histogram(g66, bins=50),
        "gap_distribution_69": histogram(g69, bins=50),
        "gap_quantiles": {
            "q01_66": quantile(g66, 0.01),
            "q50_66": quantile(g66, 0.5),
            "q99_66": quantile(g66, 0.99),
            "q01_69": quantile(g69, 0.01),
            "q50_69": quantile(g69, 0.5),
            "q99_69": quantile(g69, 0.99),
        },
        "party_gap_summary_69": party_gap_69,
        "winner_gap_watchlist_69": winner_gap_watchlist,
        "winner_gap_threshold_top3pct": summary69.get("thresholds", {}).get("winner_gap_top3pct"),
    }

    # SECTION: alignment
    align = dash.get("alignment", {})
    section_alignment = {
        "title": "ผลวิเคราะห์เลขชนและคะแนนบัญชีรายชื่อ",
        "summary": align.get("summary", {}),
        "summary_by_base_party": align.get("summary_by_base_party", []),
        "outliers": {k: {"percentile": v.get("percentile"), "threshold": v.get("threshold"), "rowCount": v.get("rowCount")} for k, v in align.get("outliers", {}).items()},
        "outlier_rows_top": {k: (v.get("rows") or [])[:200] for k, v in align.get("outliers", {}).items()},
    }

    # SECTION: targeting + บ้านใหญ่ proxy
    winner_rows = cross_features.get("winner_rows_69", [])
    winner_rows_sorted = sorted(winner_rows, key=lambda x: (x.get("winner_gap_69") or 0.0), reverse=True)

    # province-level concentration proxy
    by_prov = defaultdict(lambda: {"province_name_norm": None, "rows": 0, "sum_gap": 0.0, "close66_rows": 0, "same_party_win66_rows": 0})
    for r in winner_rows:
        p = r.get("province_name_norm") or ""
        d = by_prov[p]
        d["province_name_norm"] = p
        d["rows"] += 1
        d["sum_gap"] += r.get("winner_gap_69") or 0.0
        if r.get("is_close_seat_66"):
            d["close66_rows"] += 1
        if r.get("was_win66_same_party"):
            d["same_party_win66_rows"] += 1

    prov_targeting = []
    for d in by_prov.values():
        prov_targeting.append(
            {
                "province_name_norm": d["province_name_norm"],
                "rows": d["rows"],
                "mean_winner_gap_69": d["sum_gap"] / d["rows"] if d["rows"] else 0.0,
                "close66_ratio": d["close66_rows"] / d["rows"] if d["rows"] else 0.0,
                "same_party_win66_ratio": d["same_party_win66_rows"] / d["rows"] if d["rows"] else 0.0,
            }
        )
    prov_targeting.sort(key=lambda x: x["mean_winner_gap_69"], reverse=True)

    section_targeting = {
        "title": "Targeting เขตพอมีโอกาส และบ้านใหญ่ (proxy)",
        "winner_rows_69_top": winner_rows_sorted[:250],
        "province_targeting_summary": prov_targeting,
        "crossyear_party_comparative": cross_summary.get("party_comparative_summary", []),
        "threshold_close66": cross_summary.get("thresholds", {}).get("close_margin_66_p30"),
    }

    section_robustness = {
        "title": "Robustness และข้อจำกัด",
        "hypothesis_tests": tests69.get("tests", []),
        "mapping_quality": cross_quality,
        "coverage": cross_summary.get("coverage", {}),
        "notes": summary69.get("notes", []),
        "disclaimer": [
            "ผลลัพธ์เป็นหลักฐานเชิงสถิติและข้อสังเกตจากข้อมูล ไม่ใช่ข้อพิสูจน์ทางกฎหมาย",
            "การเทียบข้ามปีระดับเขตอาจได้รับผลจากการเปลี่ยน boundary หรือบริบทการเมืองในพื้นที่",
            "พรรคที่ยัง unmapped ใน crosswalk จะถูกแยกรายงานและไม่ใช้ใน comparative metrics หลัก",
        ],
    }

    files = {
        "section_overview.json": section_overview,
        "section_gap.json": section_gap,
        "section_alignment.json": section_alignment,
        "section_targeting.json": section_targeting,
        "section_robustness.json": section_robustness,
    }

    for fn, data in files.items():
        (out_dir / fn).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    # lightweight appendix (interactive large table source) in separate lazy file
    appendix = {
        "title": "ภาคผนวกข้อมูล",
        "comparative_rows": comp,
    }
    (out_dir / "section_appendix.json").write_text(json.dumps(appendix, ensure_ascii=False), encoding="utf-8")

    manifest = {
        "version": "1.0.0",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "sections": {
            "overview": "section_overview.json",
            "gap": "section_gap.json",
            "alignment": "section_alignment.json",
            "targeting": "section_targeting.json",
            "robustness": "section_robustness.json",
            "appendix": "section_appendix.json",
        },
        "counts": {
            "rows66": len(rows66),
            "rows69": len(rows69),
            "comparativeRows": len(comp),
            "areas69": summary69.get("counts", {}).get("areas", 0),
        },
        "thresholds": {
            "winner_gap_top3pct": summary69.get("thresholds", {}).get("winner_gap_top3pct"),
            "residual_abs_z_top3pct": summary69.get("thresholds", {}).get("residual_abs_z_top3pct"),
        },
        "hypothesis_source": "hypothesis.md",
        "dataSha": hashlib.sha256((json.dumps(section_overview, ensure_ascii=False) + hypothesis).encode("utf-8")).hexdigest(),
    }

    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote research sections to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
