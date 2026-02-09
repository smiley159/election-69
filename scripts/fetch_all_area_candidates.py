#!/usr/bin/env python3
import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import urljoin
from urllib.request import Request, urlopen

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def fetch_text(url: str, timeout: int = 30) -> str:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_json(url: str, timeout: int = 30):
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*"})
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def area_ids_from_common(common_path: Path) -> list[str]:
    data = json.loads(common_path.read_text(encoding="utf-8"))
    ids: list[str] = []
    for area in data.get("areas", []):
        code = area.get("code", "")
        m = re.fullmatch(r"AREA-(\d{4})", code)
        if m:
            ids.append(m.group(1))
    return sorted(set(ids))


def build_from_template(template: str, area_id: str) -> str:
    area_code = f"AREA-{area_id}"
    if "{area_id}" in template or "{area_code}" in template:
        return template.format(area_id=area_id, area_code=area_code)

    out = template
    # Replace explicit area code tokens like AREA-1001, AREA-8101, etc.
    # Avoid replacing any other 4-digit numbers in URL (e.g. timestamps, years).
    out = re.sub(r"AREA-\d{4}", area_code, out)
    return out


def extract_json_urls(html: str, page_url: str) -> list[str]:
    # Pick absolute URLs first, then relative paths ending with .json
    abs_urls = re.findall(r"https?://[^\"'\s<>]+?\.json(?:\?[^\"'\s<>]*)?", html)
    rel_urls = re.findall(r"(?:/|\.\./|\./)[^\"'\s<>]+?\.json(?:\?[^\"'\s<>]*)?", html)

    urls = [u.replace("\\u0026", "&") for u in abs_urls]
    urls.extend(urljoin(page_url, u.replace("\\u0026", "&")) for u in rel_urls)

    # keep order, dedupe
    seen = set()
    ordered: list[str] = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            ordered.append(u)
    return ordered


def is_candidate_payload(payload) -> bool:
    entries = payload.get("entries") if isinstance(payload, dict) else None
    return isinstance(entries, list) and len(entries) > 1


def discover_candidate_url(area_id: str, page_template: str) -> Optional[str]:
    page_url = build_from_template(page_template, area_id)
    html = fetch_text(page_url)
    urls = extract_json_urls(html, page_url)

    # Try URLs containing area id first.
    ranked = sorted(
        urls,
        key=lambda u: (
            f"AREA-{area_id}" not in u and area_id not in u,
            "winner" in u.lower(),
            len(u),
        ),
    )

    for u in ranked:
        try:
            payload = fetch_json(u)
        except Exception:
            continue
        if is_candidate_payload(payload):
            return u
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download all area candidate-result JSON files for Thai PBS election69"
    )
    parser.add_argument("--common", default="common-data.json", help="Path to common-data.json")
    parser.add_argument("--out-dir", default="area-candidates", help="Output directory")
    parser.add_argument(
        "--template-url",
        default="",
        help=(
            "Template URL to candidate JSON. Supports {area_id} and {area_code}. "
            "If omitted, script tries to discover JSON URL from each area page."
        ),
    )
    parser.add_argument(
        "--page-url-template",
        default="https://www.thaipbs.or.th/election69/result/geo/area/{area_id}?region=all&view=area",
        help="Area page URL template used in discover mode",
    )
    parser.add_argument(
        "--winner-template-url",
        default="",
        help="Optional template URL for winner JSON (same placeholders)",
    )
    parser.add_argument("--sleep", type=float, default=0.1, help="Delay between requests (seconds)")

    args = parser.parse_args()

    common_path = Path(args.common)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    area_ids = area_ids_from_common(common_path)
    if not area_ids:
        print("No area codes found in common-data.json", file=sys.stderr)
        return 1

    failures: list[str] = []

    for i, area_id in enumerate(area_ids, start=1):
        area_code = f"AREA-{area_id}"
        try:
            if args.template_url:
                candidate_url = build_from_template(args.template_url, area_id)
            else:
                candidate_url = discover_candidate_url(area_id, args.page_url_template)

            if not candidate_url:
                raise RuntimeError("candidate URL not found")

            payload = fetch_json(candidate_url)
            if not is_candidate_payload(payload):
                raise RuntimeError(f"unexpected payload shape from {candidate_url}")

            candidate_path = out_dir / f"{area_code}.json"
            candidate_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

            if args.winner_template_url:
                winner_url = build_from_template(args.winner_template_url, area_id)
                winner_payload = fetch_json(winner_url)
                winner_path = out_dir / f"{area_code}-winner.json"
                winner_path.write_text(json.dumps(winner_payload, ensure_ascii=False, indent=2), encoding="utf-8")

            print(f"[{i}/{len(area_ids)}] ok {area_code}")
        except Exception as e:
            failures.append(area_code)
            print(f"[{i}/{len(area_ids)}] fail {area_code}: {e}", file=sys.stderr)

        if args.sleep > 0:
            time.sleep(args.sleep)

    print(f"done: success={len(area_ids) - len(failures)} fail={len(failures)}")
    if failures:
        print("failed areas:", ", ".join(failures), file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
