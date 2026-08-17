#!/usr/bin/env python3
"""
Extract the CIH/Euronics daily member price list (.xlsx) to flat JSON.

Sachin forwards this file most mornings. It is a pivot workbook: the visible
first tabs are collapsed pivots (they look empty in a mail preview), and the
real rows live on the "Full Data" sheet. This reader goes straight there.

Stdlib only — no openpyxl/pandas — so it runs on any Python 3 without installs.
An .xlsx is a zip of XML; we read shared strings once, then stream the sheet.

    python scripts/catalog/euronics-xlsx-extract.py <file.xlsx> [out.json]

Columns taken from Full Data (headers verified 2026-08-14):
    A Brand Name        -> brand
    B Model Number      -> model      (the match key)
    C Product Category  -> category
    D Stock type        -> stockType  ("AGENCY"/"CENTRAL")
    F B2B Price         -> b2b         (trade cost, EX-VAT)
    I B2C Agency Price  -> b2cAgency   (retail, INC-VAT — the price to show)
    L Previous B2C      -> prevB2c
    AE End of Life      -> endOfLife   ("Yes"/"No")
    AI EAN              -> ean
    AJ/AK Stock flags   -> stockSouth/stockTank
    AL Warranty         -> warranty
"""
import json
import re
import sys
import io
import zipfile
from xml.etree.ElementTree import iterparse

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
WANT = {
    "A": "brand", "B": "model", "C": "category", "D": "stockType",
    "F": "b2b", "I": "b2cAgency", "L": "prevB2c", "AE": "endOfLife",
    "AI": "ean", "AJ": "stockSouth", "AK": "stockTank", "AL": "warranty",
}
SHEET_NAME = "Full Data"


def col_letters(ref):
    return re.match(r"[A-Z]+", ref).group(0)


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: euronics-xlsx-extract.py <file.xlsx> [out.json]")
    path = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    z = zipfile.ZipFile(path)

    # workbook.xml maps sheet NAME -> r:id, and the rels map r:id -> file part.
    wb = z.read("xl/workbook.xml").decode("utf-8", "replace")
    rid = None
    for m in re.finditer(r'<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"', wb):
        if m.group(1).strip().lower() == SHEET_NAME.lower():
            rid = m.group(2)
    if not rid:
        sys.exit(f'No "{SHEET_NAME}" sheet — tabs are: ' +
                 ", ".join(re.findall(r'<sheet[^>]*name="([^"]+)"', wb)))
    rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8", "replace")
    part = None
    for m in re.finditer(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels):
        if m.group(1) == rid:
            part = "xl/" + m.group(2).lstrip("/")
    if part not in z.namelist():
        sys.exit(f"sheet part {part} not found in archive")

    # Shared strings, read once.
    sst = []
    if "xl/sharedStrings.xml" in z.namelist():
        for _ev, el in iterparse(io.BytesIO(z.read("xl/sharedStrings.xml"))):
            if el.tag == NS + "si":
                sst.append("".join(t.text or "" for t in el.iter(NS + "t")))
                el.clear()

    rows = []
    for _ev, el in iterparse(io.BytesIO(z.read(part))):
        if el.tag != NS + "row":
            continue
        if el.get("r") == "1":  # header row
            el.clear()
            continue
        rec = {}
        for c in el.findall(NS + "c"):
            key = WANT.get(col_letters(c.get("r")))
            if not key:
                continue
            v = c.find(NS + "v")
            val = v.text if v is not None else None
            if c.get("t") == "s" and val is not None:
                val = sst[int(val)]
            if val is not None and str(val).strip():
                rec[key] = str(val).strip()
        if rec.get("model"):
            rows.append(rec)
        el.clear()

    payload = json.dumps(rows, ensure_ascii=False)
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(payload)
        print(f"wrote {len(rows)} rows -> {out}", file=sys.stderr)
    else:
        sys.stdout.write(payload)


if __name__ == "__main__":
    main()
