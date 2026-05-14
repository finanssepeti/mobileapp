#!/usr/bin/env python3
"""
Örnek: Yahoo Finance (yfinance) ile NASDAQ hisselerinin son kapanış fiyatını (USD) çeker.

Kurulum:
  pip install yfinance

Not: Yahoo’nun halka açık bir “resmi” fiyat API’si yok; yfinance tersine mühendislik
tabanlıdır. Üretimde rate limit, kesinti ve kullanım koşullarına dikkat edin.
"""
from __future__ import annotations

import argparse
import sys
from typing import Optional, Tuple


def last_close_usd(ticker: str) -> Tuple[Optional[float], Optional[str]]:
    import yfinance as yf

    t = yf.Ticker(ticker)
    hist = t.history(period="5d", interval="1d")
    if hist is None or hist.empty:
        return None, "veri yok"
    close = float(hist["Close"].iloc[-1])
    return close, None


def main() -> int:
    parser = argparse.ArgumentParser(description="Yahoo Finance ile hisse son fiyatları (USD)")
    parser.add_argument(
        "tickers",
        nargs="*",
        default=["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"],
        help="Yahoo sembolleri (örn. AAPL MSFT). Boşsa örnek NASDAQ listesi.",
    )
    args = parser.parse_args()

    try:
        import yfinance  # noqa: F401
    except ImportError:
        print("Önce kurun: pip install yfinance", file=sys.stderr)
        return 1

    tickers = [t.strip().upper() for t in args.tickers if t.strip()]
    if not tickers:
        print("En az bir ticker girin.", file=sys.stderr)
        return 1

    print(f"{'Sembol':<10} {'Birim fiyat (USD, son kapanış)':>32}")
    print("-" * 46)
    for sym in tickers:
        price, err = last_close_usd(sym)
        if err or price is None:
            print(f"{sym:<10} {'—':>32}  ({err or 'bilinmeyen hata'})")
        else:
            print(f"{sym:<10} {price:>32,.4f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
