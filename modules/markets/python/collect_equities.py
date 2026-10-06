#!/usr/bin/env python3
"""Daily public-price adapters. stdout is one JSON object; provider chatter goes to stderr.

Interfaces: https://akshare.akfamily.xyz/data/index/index.html
https://akshare.akfamily.xyz/data/stock/stock.html
https://ranaroussi.github.io/yfinance/reference/api/yfinance.Ticker.history.html
Calendars: https://pandas-market-calendars.readthedocs.io/en/stable/pandas_market_calendars.html
Provider access and redistribution remain subject to their own terms.
"""
from __future__ import annotations

import argparse
from contextlib import redirect_stdout
from datetime import date, datetime, time, timedelta, timezone
import json
import math
import os
from pathlib import Path
import sys
from urllib.parse import quote
from zoneinfo import ZoneInfo

UTC = timezone.utc
CN = ZoneInfo("Asia/Shanghai")
US = ZoneInfo("America/New_York")
MARKETS = {
    "cn": {"zone": CN, "calendar": None},
    "us": {"zone": US, "calendar": "NYSE"},
    "hk": {"zone": ZoneInfo("Asia/Hong_Kong"), "calendar": "XHKG"},
    "kr": {"zone": ZoneInfo("Asia/Seoul"), "calendar": "XKRX"},
    "jp": {"zone": ZoneInfo("Asia/Tokyo"), "calendar": "JPX"},
}
INSTRUMENTS = {
    "akshare": (
        {"id": "cn-sse-composite", "symbol": "sh000001", "stock": False, "market": "cn"},
        {"id": "cn-csi300", "symbol": "sh000300", "stock": False, "market": "cn"},
        {"id": "600519.sh", "symbol": "sh600519", "stock": True, "market": "cn"},
    ),
    "yfinance": (
        {"id": "us-sp500", "symbol": "^GSPC", "stock": False, "market": "us"},
        {"id": "us-nasdaq100", "symbol": "^NDX", "stock": False, "market": "us"},
        {"id": "aapl", "symbol": "AAPL", "stock": True, "market": "us"},
        {"id": "msft", "symbol": "MSFT", "stock": True, "market": "us"},
        {"id": "nvda", "symbol": "NVDA", "stock": True, "market": "us"},
        {"id": "hk-hsi", "symbol": "^HSI", "stock": False, "market": "hk"},
        {"id": "kr-kospi", "symbol": "^KS11", "stock": False, "market": "kr"},
        {"id": "jp-nikkei225", "symbol": "^N225", "stock": False, "market": "jp"},
    ),
}

# XKRX's bundled CSAT dates stop at 2020; never invent a future special-session close.
# Confirmed 2025 notice: https://securities.miraeasset.com/bbs/board/message/view.do?categoryId=66&messageId=2335796
KR_CONFIRMED_CLOSES = {date(2025, 11, 13): time(16, 30)}
# Announced 2026 closures absent from XKRX 4.13.2's holiday set.
# https://www.samsungpop.com/ux/kor/customer/notice/notice/noticeViewContent.do?MenuSeqNo=23996
# https://kind.krx.co.kr/external/2026/05/20/000110/20260520000197/32154.htm
KR_CONFIRMED_HOLIDAYS = {date(2026, 6, 3), date(2026, 7, 17)}
# The education ministry confirms this exam date, not KRX's trading hours. Reject its bars until confirmed.
# https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=100526&lev=0&m=020402&opType=N&s=moe&statusYN=W
KR_UNCONFIRMED_SESSIONS = {date(2026, 11, 19)}


def instant(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("Timezone-aware collection time required")
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def year_start(day: date) -> date:
    try:
        return day.replace(year=day.year - 1)
    except ValueError:  # February 29 has no counterpart in a non-leap year.
        return day.replace(year=day.year - 1, day=28)


def trading_date(value, zone: ZoneInfo) -> date:
    if isinstance(value, datetime):
        return (value.astimezone(zone) if value.tzinfo else value).date()
    if isinstance(value, date):
        return value
    text = str(value)
    if len(text) == 10:
        return date.fromisoformat(text)
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return (parsed.astimezone(zone) if parsed.tzinfo else parsed).date()


def positive(value) -> float:
    if value is None or isinstance(value, bool):
        raise ValueError("Missing or invalid closing price")
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise ValueError("Closing price must be finite and positive")
    return number


def normalized_rows(rows, instrument: dict, now: datetime, sessions: dict[date, datetime] | None):
    market = MARKETS[instrument["market"]]
    zone = market["zone"]
    first = year_start(now.astimezone(zone).date())
    result = {}
    for row in rows:
        day = trading_date(row["date"], zone)
        if day < first or day > now.astimezone(zone).date():
            continue
        if instrument["market"] == "kr" and day in KR_UNCONFIRMED_SESSIONS:
            raise ValueError(f"KRX special-session closing time is unconfirmed: {day}")
        if market["calendar"]:
            if sessions is None:
                raise ValueError("Exchange closing schedule is required")
            close_at = sessions.get(day)
            if close_at is None:  # Weekend, holiday or a non-session vendor row.
                continue
        else:
            if day.weekday() >= 5:
                continue
            close_at = datetime.combine(day, time(15), CN)
        if close_at.tzinfo is None:
            raise ValueError("Exchange closing schedule must include timezones")
        if close_at > now:
            continue
        if day in result:
            raise ValueError(f"Duplicate trading day: {day}")
        result[day] = (positive(row["close"]), close_at)
    if not result:
        raise ValueError("No completed trading-day history in the past year")
    return dict(sorted(result.items())[-260:])


def build_instrument(instrument: dict, source: str, raw_rows, adjusted_rows,
                     now: datetime, sessions: dict[date, datetime] | None = None):
    """Pure conversion: a failed instrument contributes neither quotes nor history."""
    published_at = instant(now)
    raw = normalized_rows(raw_rows, instrument, now, sessions)
    adjusted = normalized_rows(adjusted_rows, instrument, now, sessions) if instrument["stock"] else raw
    if set(raw) != set(adjusted):
        raise ValueError("Raw and adjusted trading dates disagree")
    dates = list(raw)
    latest = dates[-1]
    if source == "yfinance":
        name = "Yahoo Finance（yfinance）"
        url = f'https://finance.yahoo.com/quote/{quote(instrument["symbol"], safe="")}/history/'
    else:
        name = "新浪财经（AKShare）"
        url = f'https://finance.sina.com.cn/realstock/company/{instrument["symbol"]}/nc.shtml'
    provenance = {"sourceName": name, "sourceUrl": url, "publishedAt": published_at,
                  "availabilityBasis": "retrieved"}
    latest_quote = {"instrumentId": instrument["id"], "value": raw[latest][0],
                    "previousClose": raw[dates[-2]][0] if len(dates) > 1 else None,
                    "asOf": instant(raw[latest][1]), "frequency": "daily",
                    "unit": "price" if instrument["stock"] else "points", **provenance}
    history = [{"instrumentId": instrument["id"], "date": day.isoformat(),
                "close": adjusted[day][0], "priceBasis": "adjusted" if instrument["stock"] else "unadjusted",
                **provenance} for day in dates]
    return latest_quote, history


def fetch_akshare(instrument: dict, now: datetime):
    import akshare as ak
    if not instrument["stock"]:
        # Documented Sina daily index endpoint uses exchange-prefixed symbols.
        frame = ak.stock_zh_index_daily(symbol=instrument["symbol"])
        return [{"date": row["date"], "close": row["close"]} for row in frame.to_dict("records")], None
    args = {"symbol": instrument["symbol"],
            "start_date": year_start(now.astimezone(CN).date()).strftime("%Y%m%d"),
            "end_date": now.astimezone(CN).strftime("%Y%m%d")}
    # This documented Sina interface has no per-request timeout; the worker bounds the process.
    raw = ak.stock_zh_a_daily(**args, adjust="")
    adjusted = ak.stock_zh_a_daily(**args, adjust="qfq")
    records = lambda frame: [{"date": row["date"], "close": row["close"]} for row in frame.to_dict("records")]
    return records(raw), records(adjusted)


def fetch_yfinance(instrument: dict, now: datetime):
    import yfinance as yf
    cache = Path(os.environ.get("MARKET_CACHE_DIR", ".data/markets-cache"))
    cache.mkdir(parents=True, exist_ok=True)
    yf.set_tz_cache_location(str(cache))
    today = now.astimezone(MARKETS[instrument["market"]]["zone"]).date()
    frame = yf.Ticker(instrument["symbol"]).history(
        start=year_start(today).isoformat(), end=(today + timedelta(days=1)).isoformat(),
        interval="1d", auto_adjust=False, back_adjust=False, actions=False,
        repair=False, keepna=True, timeout=20,
    )
    raw = [{"date": day, "close": row["Close"]} for day, row in frame.iterrows()]
    adjusted = [{"date": day, "close": row["Adj Close"]} for day, row in frame.iterrows()] if instrument["stock"] else None
    return raw, adjusted


def exchange_sessions(market_id: str, now: datetime):
    import pandas_market_calendars as calendars
    market = MARKETS[market_id]
    today = now.astimezone(market["zone"]).date()
    if market_id == "kr" and (year_start(today) < date(2025, 1, 1) or today > date(2026, 12, 31)):
        raise ValueError("KRX special-session coverage requires review outside 2025–2026")
    calendar = calendars.get_calendar(market["calendar"])
    # Only closing times are needed: a lunch break must never finalize a daily bar.
    schedule = calendar.schedule(start_date=year_start(today), end_date=today,
                                 market_times=["market_close"], force_special_times=False)
    sessions = {day.date(): row["market_close"].to_pydatetime() for day, row in schedule.iterrows()}
    if market_id == "hk":
        # XHKG includes half-days that PMC's HKEX calendar omits. Include the closing-auction
        # upper bound (16:10 / 12:10), not the earlier continuous-session end or an invented print time.
        # https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market
        sessions = {day: close + timedelta(minutes=10) for day, close in sessions.items()}
    elif market_id == "kr":
        for day, close in KR_CONFIRMED_CLOSES.items():
            if day in sessions:
                sessions[day] = datetime.combine(day, close, market["zone"])
        for day in KR_UNCONFIRMED_SESSIONS | KR_CONFIRMED_HOLIDAYS:
            sessions.pop(day, None)
    return sessions


def collect(source: str, fetch=None, clock=None, sessions=None):
    clock = clock or (lambda: datetime.now(UTC))
    fetch = fetch or (fetch_akshare if source == "akshare" else fetch_yfinance)
    output = {"quotes": [], "history": [], "errors": []}
    # One local calendar build per market, with failures isolated to that market's instruments.
    calendars = {} if sessions is None else dict(sessions)
    for instrument in INSTRUMENTS[source]:
        try:
            market = instrument["market"]
            if MARKETS[market]["calendar"] and market not in calendars:
                try:
                    calendars[market] = exchange_sessions(market, clock())
                except Exception as error:
                    calendars[market] = error
            schedule = calendars.get(market)
            if isinstance(schedule, Exception):
                raise schedule
            raw, adjusted = fetch(instrument, clock())
            result, history = build_instrument(instrument, source, raw, adjusted, clock(), schedule)
            output["quotes"].append(result)
            output["history"].extend(history)
        except Exception as error:
            message = f"{type(error).__name__}: {error}".replace("\n", " ")[:500]
            print(f'{instrument["id"]}: {message}', file=sys.stderr)
            output["errors"].append({"instrumentId": instrument["id"], "message": message})
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description="Collect completed daily equity closes")
    parser.add_argument("--source", required=True, choices=tuple(INSTRUMENTS))
    args = parser.parse_args(argv)
    # Library imports, progress bars and provider notices must not corrupt the JSON protocol.
    with redirect_stdout(sys.stderr):
        result = collect(args.source)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
