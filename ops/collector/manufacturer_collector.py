#!/usr/bin/env python3
"""
Manufacturer RRP collector — Bosch / Neff / Smeg / Caple.

Runs nightly on the shop's OCI box (cron, after the Euronics n8n run). For each
catalogue product whose sourceUrl points at a manufacturer's own site, it reads
the CURRENT published price and posts it to the app's signed ingest API under
the ADVISORY source "manufacturer-rrp" — which the guards never allow to
auto-apply. These prices land in the /admin/price-watch review queue only:
the shop buys these lines through a distributor at a cost we do not know, so
no machine may move them.

Extraction is tiered by trust, cheapest and most reliable first:

  tier 0  JSON-LD Product.offers.price      exact, free, can't hallucinate.
          NEVER the biggest "£" on the page — Bosch renders the OLD price
          visibly and the real one only in structured data.
  tier 1  Scrapling StealthyFetcher refetch  when the plain fetch is blocked
          or the page has no JSON-LD (layout change).
  tier 2  LLM chain over a TRIMMED page:     Groq gpt-oss-120b
                                             -> Gemini flash
                                             -> Groq gpt-oss-20b
          Any LLM answer is marked matchConfidence 0.7 and noted with the
          model that produced it — the guards treat it as unconfirmed, so it
          can never even be bulk-applied without a human reading the row.

Config via /opt/pricewatch/.env (root-only):
  PW_APP_URL, PRICE_INGEST_SECRET_COLLECTOR, GROQ_API_KEY, GEMINI_API_KEY,
  PW_MAX_PRODUCTS (default 40), PW_MIN_DELAY / PW_MAX_DELAY seconds.
"""
import hashlib
import hmac
import json
import os
import random
import re
import sys
import time
import urllib.request

ENV_FILE = "/opt/pricewatch/.env"
MANUFACTURER_HOSTS = ("bosch-home.co.uk", "neff-home.com", "smeguk.com", "caple.co.uk", "siemens-home")
UA = "RuislipKitchenAppliances-PriceCheck/1.0 (dealer price sync; contact: shop via kitchen-appliances.co.uk)"
SOURCE_ID = "manufacturer-rrp"


def load_env():
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE, encoding="utf-8"):
            m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$", line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")


def sign(route, raw_body, secret):
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), f"{route}.{ts}.{raw_body}".encode(), hashlib.sha256).hexdigest()
    return {"x-pw-key": "collector", "x-pw-timestamp": ts, "x-pw-signature": sig, "content-type": "application/json"}


def api(base, route, path, body, secret, method="POST"):
    raw = "" if body is None else json.dumps(body, separators=(",", ":"))
    req = urllib.request.Request(base + path, data=None if body is None else raw.encode(),
                                 headers=sign(route, raw, secret), method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"user-agent": UA, "accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def jsonld_price(html):
    """Tier 0: the price the site publishes FOR machines."""
    for m in re.finditer(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", html, re.S):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        for node in (d if isinstance(d, list) else [d]):
            if isinstance(node, dict) and node.get("@type") == "Product":
                offers = node.get("offers") or []
                if isinstance(offers, dict):
                    offers = [offers]
                for o in offers:
                    if isinstance(o, dict) and o.get("price"):
                        try:
                            p = float(o["price"])
                            if 10 <= p <= 100000:
                                return p
                        except (TypeError, ValueError):
                            pass
    return None


def scrapling_fetch(url):
    """Tier 1: sturdier fetch for blocked/changed pages. Optional dependency."""
    try:
        from scrapling.fetchers import StealthyFetcher  # noqa
        page = StealthyFetcher.fetch(url, timeout=30)
        return getattr(page, "status", 0), getattr(page, "html_content", "") or ""
    except Exception:
        return 0, ""


def trim_for_llm(html, limit=6000):
    """Strip the page to the fragments that could carry a price. Sending whole
    pages costs ~200k tokens each and drowns the model in nav/footer noise."""
    html = re.sub(r"<(script|style|svg|noscript)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text)
    # keep windows around £ signs and the word price
    keep = []
    for m in re.finditer(r"(price|£|GBP)", text, re.I):
        keep.append(text[max(0, m.start() - 200):m.end() + 200])
        if sum(len(k) for k in keep) > limit:
            break
    return (" … ".join(keep))[:limit] or text[:limit]


PROMPT = (
    "You are extracting the CURRENT advertised retail price (GBP, inc VAT) of one product "
    "from fragments of its manufacturer product page.\n"
    "Product: {title} (model {code}).\n"
    "Rules: ignore 'old price', 'was', struck-through and monthly-finance figures; ignore accessory prices. "
    "If no current price for THIS product is present, the answer is null.\n"
    'Reply with ONLY this JSON, nothing else: {{"price": <number or null>}}\n\n'
    "FRAGMENTS:\n{body}"
)


def ask_llm(title, code, fragments):
    """Tier 2: three models, cheapest adequate first. Returns (price, model)."""
    prompt = PROMPT.format(title=title[:80], code=code, body=fragments)
    chain = [
        ("groq", "openai/gpt-oss-120b"),
        ("gemini", "gemini-3.6-flash"),
        ("groq", "openai/gpt-oss-20b"),
    ]
    for provider, model in chain:
        try:
            if provider == "groq":
                key = os.environ.get("GROQ_API_KEY", "")
                if not key:
                    continue
                req = urllib.request.Request(
                    "https://api.groq.com/openai/v1/chat/completions",
                    data=json.dumps({
                        "model": model, "temperature": 0, "max_tokens": 200,
                        "reasoning_effort": "low",
                        "messages": [{"role": "user", "content": prompt}],
                    }).encode(),
                    headers={"authorization": f"Bearer {key}", "content-type": "application/json"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    out = json.loads(r.read().decode())["choices"][0]["message"]["content"]
            else:
                key = os.environ.get("GEMINI_API_KEY", "")
                if not key:
                    continue
                req = urllib.request.Request(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    data=json.dumps({"contents": [{"parts": [{"text": prompt}]}],
                                     "generationConfig": {"temperature": 0}}).encode(),
                    headers={"x-goog-api-key": key, "content-type": "application/json"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    out = json.loads(r.read().decode())["candidates"][0]["content"]["parts"][0]["text"]
            m = re.search(r'\{[^{}]*"price"[^{}]*\}', out)
            if not m:
                continue
            val = json.loads(m.group(0)).get("price")
            if val is None:
                return None, model  # a confident "no price" is an answer too
            p = float(val)
            if 10 <= p <= 100000:
                return p, model
        except Exception:
            continue
    return None, None


def main():
    load_env()
    base = os.environ.get("PW_APP_URL", "").rstrip("/")
    secret = os.environ.get("PRICE_INGEST_SECRET_COLLECTOR", "")
    if not base or not secret:
        sys.exit("PW_APP_URL / PRICE_INGEST_SECRET_COLLECTOR missing")
    cap = int(os.environ.get("PW_MAX_PRODUCTS", "40"))
    dmin = float(os.environ.get("PW_MIN_DELAY", "5"))
    dmax = float(os.environ.get("PW_MAX_DELAY", "11"))

    wl = api(base, "worklist", f"/api/price-ingest/worklist?source={SOURCE_ID}&limit=400", None, secret, "GET")
    items = [i for i in wl.get("items", [])
             if any(h in (i.get("sourceUrl") or "") for h in MANUFACTURER_HOSTS)][:cap]
    print(f"worklist: {len(wl.get('items', []))} due, {len(items)} on manufacturer sites (cap {cap})")

    observations, counts = [], {"ok": 0, "llm": 0, "not_found": 0, "blocked": 0}
    for it in items:
        url, code = it["sourceUrl"], it["productCode"]
        note, status, price, conf = "", "ok", None, 1.0
        try:
            http, html = fetch(url)
        except Exception:
            http, html = 0, ""
        if http in (403, 429):
            status, note = "blocked", f"http {http}"
        elif http != 200 or not html:
            http2, html2 = scrapling_fetch(url)
            if http2 == 200 and html2:
                html, http = html2, http2
                note = "via scrapling"
            else:
                status, note = "not_found", f"http {http}"
        if http == 200 and html:
            price = jsonld_price(html)
            if price is None:
                # layout change or no structured data — try the sturdier fetch once
                http2, html2 = scrapling_fetch(url)
                if html2:
                    price = jsonld_price(html2)
                    if price is not None:
                        note = "json-ld via scrapling"
                if price is None:
                    price, model = ask_llm(it.get("title", ""), code, trim_for_llm(html2 or html))
                    if price is not None:
                        conf, note = 0.7, f"llm-extracted ({model})"
                        counts["llm"] += 1
                    else:
                        status, note = "not_found", "no published price (json-ld and llm both empty)"
        if price is not None:
            counts["ok"] += 1
        else:
            if status == "ok":
                status = "not_found"
            counts[status] = counts.get(status, 0) + 1
        observations.append({
            "productCode": code, "price": price, "sourceUrl": url,
            "matchConfidence": conf if price is not None else 0,
            "status": status if price is None else "ok", "note": note,
        })
        print(f"  {code:18} {status:9} {price if price is not None else '-':>9}  {note}")
        if status == "blocked":
            print("  blocked — stopping the run early rather than running into a ban")
            break
        time.sleep(random.uniform(dmin, dmax))

    for i in range(0, len(observations), 200):
        res = api(base, "observations", "/api/price-ingest/observations",
                  {"sourceId": SOURCE_ID, "observations": observations[i:i + 200]}, secret)
        print("posted:", json.dumps(res.get("bySource", {}).get(SOURCE_ID, {}).get("byStatus", {})))
    print("summary:", json.dumps(counts))


if __name__ == "__main__":
    main()
