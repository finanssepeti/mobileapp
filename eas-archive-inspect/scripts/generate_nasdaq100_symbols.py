#!/usr/bin/env python3
"""
NASDAQ-100 bileşenlerini Wikipedia tablosundan okur (pandas),
alfabetik sıralar, 101 sembolden alfabetik ilk 100'ü TypeScript'e yazar.

Mobil uygulama fiyatları Yahoo Finance HTTP ile çeker (yfinance gerekmez).

Çıktı: src/data/nasdaq100Symbols.ts
Kurulum: pip install pandas lxml
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

WIKI_URL = "https://en.wikipedia.org/wiki/Nasdaq-100"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "data" / "nasdaq100Symbols.ts"


def load_tickers() -> list[str]:
    import pandas as pd

    tables = pd.read_html(WIKI_URL, flavor="lxml")
    for df in tables:
        if "Ticker" not in df.columns:
            continue
        col = df["Ticker"].astype(str).str.strip()
        return [x for x in col.tolist() if x.isalpha() and 1 <= len(x) <= 5]
    raise RuntimeError('Wikipedia tablosunda "Ticker" sütunu bulunamadı.')


def main() -> int:
    try:
        raw = load_tickers()
    except Exception as e:
        print("Hata:", e, file=sys.stderr)
        print("Kurun: pip install pandas lxml", file=sys.stderr)
        return 1

    tickers = sorted(set(raw))
    if len(tickers) < 90:
        print("Çok az sembol:", len(tickers), file=sys.stderr)
        return 1
    # 101 bileşen varsa alfabetik ilk 100 (ör. son harf ZS düşer)
    if len(tickers) > 100:
        tickers = tickers[:100]

    body = "\n".join([f'  "{t}",' for t in tickers])
    content = (
        "/**\n"
        " * NASDAQ-100 bileşenleri — alfabetik sıralı ilk 100 (101 bileşenden sonuncu hariç).\n"
        " * Otomatik üretildi: `python scripts/generate_nasdaq100_symbols.py`\n"
        " */\n"
        "export const NASDAQ_100_SYMBOLS: readonly string[] = [\n"
        f"{body}\n"
        "] as const;\n"
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(content, encoding="utf-8")
    print(f"Yazıldı: {OUT} ({len(tickers)} sembol)")
    print(json.dumps(tickers, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
