#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build all-candidate election results from area JSON files"
    )
    parser.add_argument("--common", default="common-data.json")
    parser.add_argument("--candidates", default="candidate-data.json")
    parser.add_argument("--parties", default="party-data.json")
    parser.add_argument("--area-dir", default="area-candidates", help="Directory containing AREA-xxxx.json")
    parser.add_argument("--out-json", default="all-candidate-results.json")
    parser.add_argument("--out-csv", default="all-candidate-results.csv")
    args = parser.parse_args()

    common = load_json(Path(args.common))
    cand_data = load_json(Path(args.candidates))
    party_data = load_json(Path(args.parties))

    area_dir = Path(args.area_dir)
    if not area_dir.exists():
        raise SystemExit(f"area dir not found: {area_dir}")

    parties = {p["code"]: p for p in party_data.get("parties", [])}
    areas = {a["code"]: a for a in common.get("areas", [])}
    provinces = {p["code"]: p for p in common.get("provinces", [])}

    # (areaCode, partyCode) -> result row from AREA-xxxx.json entries
    result_by_area_party = {}
    for area_file in sorted(area_dir.glob("AREA-*.json")):
        payload = load_json(area_file)
        area_code = payload.get("areaCode")
        for e in payload.get("entries", []):
            key = (area_code, e.get("partyCode"))
            result_by_area_party[key] = e

    rows = []
    missing_vote_count = 0
    for c in cand_data.get("candidates", []):
        area_code = c.get("areaCode")
        party_code = c.get("partyCode")

        area = areas.get(area_code, {})
        province = provinces.get(area.get("provinceCode"), {})
        party = parties.get(party_code, {})
        result = result_by_area_party.get((area_code, party_code), {})

        vote_total = result.get("voteTotal")
        vote_percent = result.get("votePercent")
        rank = result.get("rank")

        if vote_total is None:
            missing_vote_count += 1

        full_name = f"{c.get('prefix','')}{c.get('specialPrefix','')}{c.get('firstName','')} {c.get('lastName','')}".strip()

        rows.append(
            {
                "candidateCode": c.get("code"),
                "areaCode": area_code,
                "areaName": area.get("name"),
                "areaNumber": area.get("number"),
                "provinceCode": area.get("provinceCode"),
                "provinceName": province.get("name"),
                "partyCode": party_code,
                "partyName": party.get("name"),
                "candidateNumber": c.get("number"),
                "candidateName": full_name,
                "voteTotal": vote_total,
                "votePercent": vote_percent,
                "rank": rank,
            }
        )

    rows.sort(key=lambda r: (r["areaCode"] or "", (r["rank"] if r["rank"] is not None else 9999), (r["candidateNumber"] if r["candidateNumber"] is not None else 9999)))

    out_json = Path(args.out_json)
    out_json.write_text(json.dumps({"rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")

    out_csv = Path(args.out_csv)
    fieldnames = [
        "candidateCode",
        "areaCode",
        "areaName",
        "areaNumber",
        "provinceCode",
        "provinceName",
        "partyCode",
        "partyName",
        "candidateNumber",
        "candidateName",
        "voteTotal",
        "votePercent",
        "rank",
    ]
    with out_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"done: {len(rows)} candidates")
    print(f"missing votes: {missing_vote_count}")
    print(f"json: {out_json}")
    print(f"csv: {out_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
