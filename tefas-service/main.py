"""
TEFAS yatırım fonları (YAT) — resmi sitedeki BindHistoryInfo uç noktasından günlük liste.
Mobil uygulama EXPO_PUBLIC_TEFAS_BASE_URL ile bu servise bağlanır.
Pip/Python yoksa aynı API için: mobileapp kökünde `npm run tefas-service` (tefas-service/server.mjs).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

ROOT = "https://www.tefas.gov.tr"
INFO_API = f"{ROOT}/api/DB/BindHistoryInfo"
REFERER_PAGE = f"{ROOT}/TarihselVeriler.aspx"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

logger = logging.getLogger("tefas")
app = FastAPI(title="TEFAS proxy", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _nearest_weekday(d: datetime) -> str:
    cur = d
    while cur.weekday() > 4:
        cur -= timedelta(days=1)
    return cur.strftime("%d.%m.%Y")


def _bind_payload(bastarih: str, bittarih: str, fonkod: str) -> dict[str, str]:
    return {
        "fontip": "YAT",
        "sfontur": "",
        "fonkod": (fonkod or "").strip().upper(),
        "fongrup": "",
        "bastarih": bastarih,
        "bittarih": bittarih,
        "fonturkod": "",
        "fonunvantip": "",
        "kurucukod": "",
    }


def _post_headers(ajax: bool) -> dict[str, str]:
    h: dict[str, str] = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": REFERER_PAGE,
        "Origin": ROOT,
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    }
    if ajax:
        h["X-Requested-With"] = "XMLHttpRequest"
    return h


def _parse_bind_response(body: object) -> tuple[list[dict] | None, str | None]:
    if not isinstance(body, dict):
        return None, "yanıt obje değil"
    fault = body.get("fault")
    if isinstance(fault, dict):
        fc = fault.get("faultCode") or fault.get("FaultCode") or ""
        fs = fault.get("faultString") or fault.get("FaultString") or ""
        if fc or fs:
            fs_clean = str(fs).replace("\n", " ").strip()[:220]
            return None, f"{fc or 'fault'}: {fs_clean}" if fs_clean else str(fc or "fault")
    data = body.get("data")
    if not isinstance(data, list):
        return None, "data[] yok"
    rows = [x for x in data if isinstance(x, dict)]
    if rows:
        return rows, None
    return None, "data[] boş"


def fetch_yat_rows(bastarih: str, bittarih: str, fonkod: str) -> list[dict]:
    payload = _bind_payload(bastarih, bittarih, fonkod)
    attempts: list[str] = []

    for ajax in (False, True):
        sess = requests.Session()
        h = _post_headers(ajax)
        r = sess.post(INFO_API, data=payload, headers=h, timeout=90)
        if r.ok:
            try:
                rows, err = _parse_bind_response(r.json())
            except Exception:
                attempts.append(r.text[:180].strip() or "JSON ayrıştırılamadı")
                rows, err = None, None
            if rows is not None:
                return rows
            if err:
                attempts.append(err)
        else:
            attempts.append(f"HTTP {r.status_code} {r.text[:180]}")

        sess.get(
            REFERER_PAGE,
            headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "tr-TR,tr;q=0.9",
            },
            timeout=25,
        )
        r = sess.post(INFO_API, data=payload, headers=h, timeout=90)
        if r.ok:
            try:
                rows, err = _parse_bind_response(r.json())
            except Exception:
                attempts.append(r.text[:180].strip() or "JSON ayrıştırılamadı")
                rows, err = None, None
            if rows is not None:
                return rows
            if err:
                attempts.append(err)
        else:
            attempts.append(f"HTTP {r.status_code} {r.text[:180]}")

    tail = attempts[-1] if attempts else "bilinmeyen"
    raise requests.RequestException(f"TEFAS ERR (BindHistory): {tail[:240]}")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/yat-funds")
def yat_funds(date: str | None = Query(None, description="Tarih dd.mm.yyyy; boşsa son iş günü")):
    """
    Tüm YAT fonları için seçilen günün kapanış bilgisi (FONKODU, FONUNVAN, FIYAT).
    """
    try:
        if date and len(date) == 10 and date[2] == "." and date[5] == ".":
            bastarih = bittarih = date
        elif date:
            raise HTTPException(status_code=400, detail="date formatı dd.mm.yyyy olmalı")
        else:
            bastarih = bittarih = _nearest_weekday(datetime.now())
        rows = fetch_yat_rows(bastarih, bittarih, "")
        by_code: dict[str, dict] = {}
        for row in rows:
            code = (row.get("FONKODU") or "").strip().upper()
            if not code:
                continue
            title = (row.get("FONUNVAN") or "").strip() or code
            raw_price = row.get("FIYAT")
            price: float | None
            try:
                price = float(raw_price) if raw_price is not None else None
            except (TypeError, ValueError):
                price = None
            prev = by_code.get(code)
            if prev is None:
                by_code[code] = {"code": code, "name": title, "price": price}
            else:
                if price is not None:
                    prev["price"] = price
                if title and len(title) >= len(prev.get("name") or ""):
                    prev["name"] = title

        funds = sorted(by_code.values(), key=lambda x: x["code"])
        return {"asOf": bastarih, "count": len(funds), "funds": funds}
    except requests.RequestException as e:
        logger.warning("TEFAS isteği başarısız: %s", e)
        raise HTTPException(status_code=502, detail=f"TEFAS erişim hatası: {e}") from e


@app.get("/yat-fund/{code}")
def yat_fund_detail(code: str, date: str | None = Query(None)):
    """Tek fon kodu (örn. AAK) için aynı gün satırı."""
    c = (code or "").strip().upper()
    if not c:
        raise HTTPException(status_code=400, detail="Geçersiz fon kodu")
    if date:
        if len(date) != 10 or date[2] != "." or date[5] != ".":
            raise HTTPException(status_code=400, detail="date formatı dd.mm.yyyy olmalı")
        bastarih = bittarih = date
    else:
        bastarih = bittarih = _nearest_weekday(datetime.now())
    try:
        rows = fetch_yat_rows(bastarih, bittarih, c)
        if not rows:
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
        row = rows[-1]
        title = (row.get("FONUNVAN") or "").strip() or c
        raw_price = row.get("FIYAT")
        try:
            price = float(raw_price) if raw_price is not None else None
        except (TypeError, ValueError):
            price = None
        return {"asOf": bastarih, "code": c, "name": title, "price": price}
    except HTTPException:
        raise
    except requests.RequestException as e:
        logger.warning("TEFAS isteği başarısız: %s", e)
        raise HTTPException(status_code=502, detail=f"TEFAS erişim hatası: {e}") from e
