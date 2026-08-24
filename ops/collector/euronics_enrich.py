#!/usr/bin/env python3
"""
Enrich catalogue products from euronics.co.uk: image, full title, description.

Runs on the OCI box (a residential/office IP gets Cloudflare-challenged after a
handful of requests; that server does not). Products imported from the CIH
spreadsheet have no image because the feed carries none — this fills that in.

For each product: search Euronics by product code, follow the first /p/ link,
read the PDP's JSON-LD (name, image, description), download the image, and
write it to an output directory named exactly as the site expects:

    out/catalog/euronics/<PRODUCTCODE>/01.<ext>

That tree is then copied into public/ on the dev machine and committed, which
is how every other image on this site is served (the Vercel Blob store is
suspended, so images are self-hosted). Downloading rather than hotlinking the
Amplience CDN keeps the site working if they change or block it.

Writes a manifest.json of {productCode: {image, title, description}} so the
database update is a separate, reviewable step — this script only gathers.

    python3 euronics_enrich.py --out /opt/pricewatch/enrich --limit 200
"""
import argparse
import html as _html
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
SEARCH = "https://www.euronics.co.uk/search?text="
BASE = "https://www.euronics.co.uk"


def fetch(url, timeout=25, binary=False):
    req = urllib.request.Request(url, headers={"user-agent": UA, "accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, (r.read() if binary else r.read().decode("utf-8", "replace"))


def product_link(html, code):
    """First /p/ link whose SKU contains the model code — Euronics SKUs are
    brand-prefixed (CCFM4552W -> BEKCCFM4552W), so match by containment."""
    norm = re.sub(r"[^A-Z0-9]", "", code.upper())
    links = re.findall(r'href="(/catalogue/[^"]*?/p/([A-Z0-9._-]+))"', html)
    for href, sku in links:
        if norm and norm in re.sub(r"[^A-Z0-9]", "", sku.upper()):
            return href
    return links[0][0] if links else None


def jsonld_product(html):
    for m in re.finditer(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", html, re.S):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        for n in (d if isinstance(d, list) else [d]):
            if isinstance(n, dict) and n.get("@type") == "Product":
                return n
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", required=True, help="file with one product code per line")
    ap.add_argument("--out", default="/opt/pricewatch/enrich")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--min-delay", type=float, default=3.0)
    ap.add_argument("--max-delay", type=float, default=6.0)
    a = ap.parse_args()

    codes = [c.strip() for c in open(a.codes, encoding="utf-8") if c.strip()][: a.limit]
    os.makedirs(a.out, exist_ok=True)
    manifest_path = os.path.join(a.out, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {}

    stats = {"ok": 0, "no_match": 0, "no_image": 0, "blocked": 0, "cached": 0}
    for i, code in enumerate(codes, 1):
        if code in manifest:
            stats["cached"] += 1
            continue
        try:
            st, html = fetch(SEARCH + urllib.parse.quote(code))
            if st in (403, 429):
                print(f"  BLOCKED at {code} — stopping early rather than running into a ban")
                stats["blocked"] += 1
                break
            href = product_link(html, code)
            if not href:
                stats["no_match"] += 1
                print(f"  {code:18} no match on euronics")
                manifest[code] = {"status": "no_match"}
                continue

            st2, pdp = fetch(BASE + href)
            node = jsonld_product(pdp) or {}
            img = node.get("image")
            if isinstance(img, list):
                img = img[0] if img else None
            # JSON-LD carries HTML entities (97&#034; 4K OLED) — decode once so
            # the stored title reads as the shop would write it.
            title = _html.unescape(node.get("name") or "").strip()
            desc = _html.unescape(node.get("description") or "").strip()

            saved = ""
            if img:
                # Ask the CDN for a web-sized JPEG. The unmodified original is
                # ~1.2MB — 754 of those is ~2GB, and these images are committed
                # to the repo (the Blob store is suspended). w=800 q=80 is 55KB,
                # visually identical at the sizes the site actually renders.
                clean = img.split("?")[0] + "?w=800&fmt=jpg&qlt=80"
                ext = ".jpg"  # we explicitly request fmt=jpg above
                if ext not in (".jpg", ".jpeg", ".png", ".webp"):
                    ext = ".jpg"
                try:
                    ist, blob = fetch(clean, binary=True)
                    if ist == 200 and len(blob) > 2000:
                        d = os.path.join(a.out, "catalog", "euronics", code)
                        os.makedirs(d, exist_ok=True)
                        with open(os.path.join(d, "01" + ext), "wb") as f:
                            f.write(blob)
                        saved = f"/catalog/euronics/{code}/01{ext}"
                except Exception as e:
                    print(f"  {code:18} image download failed: {str(e)[:40]}")

            if not saved:
                stats["no_image"] += 1
            else:
                stats["ok"] += 1
            manifest[code] = {"status": "ok" if saved else "no_image", "image": saved,
                              "title": title, "description": desc[:600], "url": BASE + href}
            print(f"  {code:18} {'IMG ' + saved if saved else 'no image':50} {title[:40]}")
        except Exception as e:
            print(f"  {code:18} error {str(e)[:50]}")
            manifest[code] = {"status": "error"}

        if i % 20 == 0:
            json.dump(manifest, open(manifest_path, "w", encoding="utf-8"))
        time.sleep(random.uniform(a.min_delay, a.max_delay))

    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"))
    print(f"\n{json.dumps(stats)}  -> {manifest_path}")


if __name__ == "__main__":
    main()
