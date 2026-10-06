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
INSTRUMENTS = {
    "akshare": (
        {"id": "cn-sse-composite", "symbol": "sh000001", "stock": False},
        {"id": "cn-csi300", "symbol": "sh000300", "stock": False},
        {"id": "600519.sh", "symbol": "sh600519", "stock": True},
    ),
    "yfinance": (
        {"id": "us-sp500", "symbol": "^GSPC", "stock": False},
        {"id": "us-nasdaq100", "symbol": "^NDX", "stock": False},
        {"id": "aapl", "symbol": "AAPL", "stock": True},
        {"id": "msft", "symbol": "MSFT", "stock": True},
        {"id": "nvda", "symbol": "NVDA", "stock": True},
    ),
}


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


def normalized_rows(rows, source: str, now: datetime, sessions: dict[date, datetime] | None):
    zone = CN if source == "akshare" else US
    first = year_start(now.astimezone(zone).date())
    result = {}
    for row in rows:
        day = trading_date(row["date"], zone)
        if day < first or day > now.astimezone(zone).date():
            continue
        if source == "yfinance":
            if sessions is None:
                raise ValueError("US exchange closing schedule is required")
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
    raw = normalized_rows(raw_rows, source, now, sessions)
    adjusted = normalized_rows(adjusted_rows, source, now, sessions) if instrument["stock"] else raw
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
    today = now.astimezone(US).date()
    frame = yf.Ticker(instrument["symbol"]).history(
        start=year_start(today).isoformat(), end=(today + timedelta(days=1)).isoformat(),
        interval="1d", auto_adjust=False, back_adjust=False, actions=False,
        repair=False, keepna=True, timeout=20,
    )
    raw = [{"date": day, "close": row["Close"]} for day, row in frame.iterrows()]
    adjusted = [{"date": day, "close": row["Adj Close"]} for day, row in frame.iterrows()] if instrument["stock"] else None
    return raw, adjusted


def us_sessions(now: datetime):
    import pandas_market_calendars as calendars
    today = now.astimezone(US).date()
    # NYSE/Nasdaq cash sessions use these closes, including scheduled half-days and DST.
    schedule = calendars.get_calendar("NYSE").schedule(start_date=year_start(today), end_date=today)
    return {day.date(): row["market_close"].to_pydatetime() for day, row in schedule.iterrows()}


def collect(source: str, fetch=None, clock=None, sessions=None):
    clock = clock or (lambda: datetime.now(UTC))
    fetch = fetch or (fetch_akshare if source == "akshare" else fetch_yfinance)
    output = {"quotes": [], "history": [], "errors": []}
    # Required calendar failures are reported for every affected instrument, never silently guessed.
    calendar_error = None
    if source == "yfinance" and sessions is None:
        try:
            sessions = us_sessions(clock())
        except Exception as error:
            calendar_error = error
    for instrument in INSTRUMENTS[source]:
        try:
            if calendar_error:
                raise calendar_error
            raw, adjusted = fetch(instrument, clock())
            result, history = build_instrument(instrument, source, raw, adjusted, clock(), sessions)
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
