"""Offline fixtures only: no provider or database calls."""
from datetime import date, datetime, timedelta, timezone
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
import warnings
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("collect_equities", Path(__file__).parents[1] / "collect_equities.py")
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)
UTC = timezone.utc
CN_STOCK = collector.INSTRUMENTS["akshare"][2]
CN_INDEX = collector.INSTRUMENTS["akshare"][0]
US_STOCK = collector.INSTRUMENTS["yfinance"][2]
HK_INDEX, KR_INDEX, JP_INDEX = collector.INSTRUMENTS["yfinance"][5:]


def moment(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def rows(*pairs):
    return [{"date": day, "close": close} for day, close in pairs]


class Frame:
    def __init__(self, records):
        self.records = records

    def to_dict(self, orient):
        assert orient == "records"
        return self.records

    def iterrows(self):
        return iter(self.records)


class DailyEquityTests(unittest.TestCase):
    def test_raw_quotes_and_adjusted_stock_history_never_mix(self):
        raw = rows(("2020-01-06", 100), ("2020-01-07", 110))
        adjusted = rows(("2020-01-06", 90), ("2020-01-07", 99))
        quote, history = collector.build_instrument(CN_STOCK, "akshare", raw, adjusted, moment("2020-01-07T08:00:00Z"))
        self.assertEqual((quote["value"], quote["previousClose"]), (110, 100))
        self.assertEqual(quote["asOf"], "2020-01-07T07:00:00.000Z")
        self.assertEqual([bar["close"] for bar in history], [90, 99])
        self.assertTrue(all(bar["priceBasis"] == "adjusted" for bar in history))
        self.assertEqual(quote["unit"], "price")
        self.assertEqual(quote["sourceName"], "新浪财经（AKShare）")
        self.assertIn("sh600519", quote["sourceUrl"])
        self.assertTrue(all(bar["publishedAt"] == quote["publishedAt"] and bar["availabilityBasis"] == "retrieved" for bar in history))

    def test_indices_keep_unadjusted_points_and_do_not_require_adjusted_column(self):
        raw = rows(("2020-01-06", 3000), ("2020-01-07", 3010))
        quote, history = collector.build_instrument(CN_INDEX, "akshare", raw, None, moment("2020-01-07T08:00:00Z"))
        self.assertEqual(quote["unit"], "points")
        self.assertEqual(history[-1]["close"], quote["value"])
        self.assertTrue(all(bar["priceBasis"] == "unadjusted" for bar in history))
        self.assertEqual(quote["sourceName"], "新浪财经（AKShare）")
        self.assertIn("sh000001", quote["sourceUrl"])

    def test_china_excludes_unclosed_future_and_weekend_rows(self):
        raw = rows(("2020-01-05", 9), ("2020-01-06", 100), ("2020-01-07", 110), ("2020-01-08", 120))
        quote, history = collector.build_instrument(CN_INDEX, "akshare", raw, None, moment("2020-01-07T06:59:59Z"))
        self.assertEqual(quote["asOf"], "2020-01-06T07:00:00.000Z")
        self.assertEqual(quote["value"], 100)
        self.assertIsNone(quote["previousClose"])
        self.assertEqual([bar["date"] for bar in history], ["2020-01-06"])
        closed, _ = collector.build_instrument(CN_INDEX, "akshare", raw, None, moment("2020-01-07T07:00:00Z"))
        self.assertEqual(closed["value"], 110)

    def test_us_dst_and_half_day_closes_use_schedule_and_exchange_dates(self):
        sessions = {
            date(2020, 3, 6): moment("2020-03-06T16:00:00-05:00"),
            date(2020, 3, 9): moment("2020-03-09T16:00:00-04:00"),
        }
        raw = rows((moment("2020-03-06T05:00:00Z"), 100), (moment("2020-03-09T04:00:00Z"), 110))
        before, _ = collector.build_instrument(US_STOCK, "yfinance", raw, raw, moment("2020-03-09T19:59:59Z"), sessions)
        after, history = collector.build_instrument(US_STOCK, "yfinance", raw, raw, moment("2020-03-09T20:00:00Z"), sessions)
        self.assertEqual(before["asOf"], "2020-03-06T21:00:00.000Z")
        self.assertEqual(after["asOf"], "2020-03-09T20:00:00.000Z")
        self.assertEqual(history[-1]["date"], "2020-03-09")
        half_day = {date(2020, 11, 27): moment("2020-11-27T13:00:00-05:00")}
        quote, _ = collector.build_instrument(US_STOCK, "yfinance", rows(("2020-11-27", 120)), rows(("2020-11-27", 110)), moment("2020-11-27T18:01:00Z"), half_day)
        self.assertEqual(quote["asOf"], "2020-11-27T18:00:00.000Z")
        self.assertEqual(quote["sourceName"], "Yahoo Finance（yfinance）")

    def test_missing_nan_nonpositive_and_misaligned_prices_reject_entire_instrument(self):
        now = moment("2020-01-07T08:00:00Z")
        valid = rows(("2020-01-06", 100), ("2020-01-07", 110))
        for invalid in [None, math.nan, math.inf, -math.inf, 0, -1, True, "not a price"]:
            with self.subTest(invalid=invalid):
                with self.assertRaises((ValueError, TypeError)):
                    collector.build_instrument(CN_STOCK, "akshare", rows(("2020-01-06", 100), ("2020-01-07", invalid)), valid, now)
                with self.assertRaises((ValueError, TypeError)):
                    collector.build_instrument(CN_STOCK, "akshare", valid, rows(("2020-01-06", 100), ("2020-01-07", invalid)), now)
        with self.assertRaisesRegex(ValueError, "dates disagree"):
            collector.build_instrument(CN_STOCK, "akshare", valid, valid[:1], now)
        with self.assertRaises(KeyError):
            collector.build_instrument(CN_STOCK, "akshare", [{"date": "2020-01-07"}], valid, now)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            collector.build_instrument(CN_INDEX, "akshare", valid + valid, None, now)

    def test_empty_and_unfinished_history_never_produce_quotes(self):
        for data in [[], rows(("2020-01-07", 110))]:
            with self.assertRaisesRegex(ValueError, "No completed"):
                collector.build_instrument(CN_INDEX, "akshare", data, None, moment("2020-01-07T06:00:00Z"))
        with self.assertRaisesRegex(ValueError, "schedule is required"):
            collector.build_instrument(US_STOCK, "yfinance", rows(("2020-01-06", 100)), [], moment("2020-01-07T06:00:00Z"))
        with self.assertRaisesRegex(ValueError, "No completed"):
            collector.build_instrument(US_STOCK, "yfinance", rows(("2020-01-06", 100)), [], moment("2020-01-07T06:00:00Z"), {})

    def test_history_is_sorted_one_calendar_year_and_at_most_260_days(self):
        now = moment("2021-01-07T08:00:00Z")
        raw = [{"date": date(2019, 11, 1) + timedelta(days=i), "close": i + 1} for i in reversed(range(435))]
        _, history = collector.build_instrument(CN_INDEX, "akshare", raw, None, now)
        dates = [bar["date"] for bar in history]
        self.assertEqual(len(history), 260)
        self.assertEqual(dates, sorted(dates))
        self.assertGreaterEqual(dates[0], "2020-01-07")
        self.assertEqual(dates[-1], "2021-01-07")
        self.assertEqual(collector.year_start(date(2020, 2, 29)), date(2019, 2, 28))

    def test_partial_failure_preserves_other_instruments_without_success_error_overlap(self):
        def fetch(instrument, now):
            if instrument["stock"]:
                raise RuntimeError("fixture missing adjusted history")
            return rows(("2020-01-06", 3000)), None
        with redirect_stderr(io.StringIO()):
            result = collector.collect("akshare", fetch=fetch, clock=lambda: moment("2020-01-07T08:00:00Z"))
        self.assertEqual(len(result["quotes"]), 2)
        self.assertEqual(result["errors"], [{"instrumentId": "600519.sh", "message": "RuntimeError: fixture missing adjusted history"}])
        self.assertFalse(set(row["instrumentId"] for row in result["history"]) & set(row["instrumentId"] for row in result["errors"]))
        json.dumps(result, allow_nan=False)

    def test_yfinance_explicit_raw_and_adjusted_columns_and_cache(self):
        called = {}
        def history(**kwargs):
            called.update(kwargs)
            return Frame([(moment("2020-01-06T00:00:00-05:00"), {"Close": 100, "Adj Close": 90})])
        fake = SimpleNamespace(Ticker=lambda symbol: SimpleNamespace(history=history), set_tz_cache_location=lambda path: called.update(cache=path))
        with tempfile.TemporaryDirectory() as cache, patch.dict(os.environ, {"MARKET_CACHE_DIR": cache}), patch.dict(sys.modules, {"yfinance": fake}):
            raw, adjusted = collector.fetch_yfinance(US_STOCK, moment("2020-01-07T22:00:00Z"))
            self.assertEqual(called["cache"], cache)
        self.assertFalse(called["auto_adjust"])
        self.assertFalse(called["repair"])
        self.assertTrue(called["keepna"])
        self.assertEqual(called["timeout"], 20)
        self.assertEqual((raw[0]["close"], adjusted[0]["close"]), (100, 90))

    def test_akshare_requests_qfq_separately_and_uses_documented_sina_index(self):
        calls = []
        def history(**kwargs):
            calls.append(kwargs)
            return Frame([{"date": "2020-01-06", "close": 90 if kwargs["adjust"] == "qfq" else 100}])
        fake = SimpleNamespace(stock_zh_a_daily=history, stock_zh_index_daily=lambda **kwargs: (calls.append(kwargs) or Frame([{"date": "2020-01-06", "close": 3000}])))
        with patch.dict(sys.modules, {"akshare": fake}):
            raw, adjusted = collector.fetch_akshare(CN_STOCK, moment("2020-01-07T08:00:00Z"))
            index, basis = collector.fetch_akshare(CN_INDEX, moment("2020-01-07T08:00:00Z"))
        self.assertEqual([call["adjust"] for call in calls[:2]], ["", "qfq"])
        self.assertTrue(all(call["symbol"] == "sh600519" for call in calls[:2]))
        self.assertEqual(calls[2], {"symbol": "sh000001"})
        self.assertEqual((raw[0]["close"], adjusted[0]["close"], index[0]["close"]), (100, 90, 3000))
        self.assertIsNone(basis)

    def test_stdout_contains_only_one_json_document_even_when_provider_prints(self):
        expected = {"quotes": [], "history": [], "errors": []}
        def noisy(source):
            print("provider progress")
            return expected
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(collector, "collect", noisy), redirect_stdout(stdout), redirect_stderr(stderr):
            collector.main(["--source", "akshare"])
        self.assertEqual(json.loads(stdout.getvalue()), expected)
        self.assertEqual(stderr.getvalue(), "provider progress\n")

    def test_installed_calendars_cover_2026_and_keep_japan_extended_close(self):
        # Local package calendars only; no provider calls. The actual rules are part of the contract.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            schedules = {market: collector.exchange_sessions(market, moment("2026-12-31T23:00:00Z")) for market in ["us", "hk", "jp"]}
            korean = collector.exchange_sessions("kr", moment("2026-12-31T14:00:00Z"))
        for schedule in [*schedules.values(), korean]:
            self.assertGreater(len(schedule), 230)
            self.assertNotIn(date(2026, 1, 1), schedule)
        self.assertNotIn(date(2026, 6, 3), korean)
        self.assertNotIn(date(2026, 7, 17), korean)
        self.assertEqual(collector.instant(schedules["jp"][date(2026, 12, 30)]), "2026-12-30T06:30:00.000Z")
        self.assertNotIn(date(2026, 12, 31), schedules["jp"])
        prior_japan = collector.exchange_sessions("jp", moment("2024-11-05T12:00:00Z"))
        self.assertEqual(collector.instant(prior_japan[date(2024, 11, 1)]), "2024-11-01T06:00:00.000Z")
        self.assertEqual(collector.instant(prior_japan[date(2024, 11, 5)]), "2024-11-05T06:30:00.000Z")

    def test_hong_kong_actual_half_days_include_auction_end_and_convert_utc_date(self):
        sessions = collector.exchange_sessions("hk", moment("2026-12-31T12:00:00Z"))
        for day in [date(2026, 2, 16), date(2026, 12, 24), date(2026, 12, 31)]:
            self.assertEqual(sessions[day].astimezone(collector.MARKETS["hk"]["zone"]).strftime("%H:%M"), "12:10")
        raw = rows(("2026-02-13", 26000), (moment("2026-02-15T16:00:00Z"), 26100))
        before, _ = collector.build_instrument(HK_INDEX, "yfinance", raw, None, moment("2026-02-16T04:09:59Z"), sessions)
        after, history = collector.build_instrument(HK_INDEX, "yfinance", raw, None, moment("2026-02-16T04:10:00Z"), sessions)
        self.assertEqual(before["value"], 26000)
        self.assertEqual(after["asOf"], "2026-02-16T04:10:00.000Z")
        self.assertEqual(history[-1]["date"], "2026-02-16")
        self.assertEqual(after["unit"], "points")
        self.assertEqual(history[-1]["priceBasis"], "unadjusted")
        self.assertIn("%5EHSI", after["sourceUrl"])

    def test_asian_midday_and_unfinished_afternoon_rows_never_become_daily_closes(self):
        for instrument in [HK_INDEX, KR_INDEX, JP_INDEX]:
            with self.subTest(instrument=instrument["id"]), warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                market = instrument["market"]
                zone = collector.MARKETS[market]["zone"]
                sessions = collector.exchange_sessions(market, moment("2026-06-08T12:00:00Z"))
                raw = rows(("2026-06-05", 100), (datetime(2026, 6, 8, tzinfo=zone).astimezone(UTC), 110))
                lunch = datetime(2026, 6, 8, 12, 15, tzinfo=zone)
                quote, _ = collector.build_instrument(instrument, "yfinance", raw, None, lunch, sessions)
                self.assertEqual(quote["value"], 100)
                close = sessions[date(2026, 6, 8)]
                quote, _ = collector.build_instrument(instrument, "yfinance", raw, None, close - timedelta(seconds=1), sessions)
                self.assertEqual(quote["value"], 100)
                quote, history = collector.build_instrument(instrument, "yfinance", raw, None, close, sessions)
                self.assertEqual(quote["value"], 110)
                self.assertEqual(history[-1]["date"], "2026-06-08")
                self.assertEqual(quote["asOf"], collector.instant(close))

    def test_korean_confirmed_exam_day_delays_close_and_unknown_hours_are_rejected(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            sessions = collector.exchange_sessions("kr", moment("2026-10-06T12:00:00Z"))
        raw = rows(("2025-11-12", 2900), ("2025-11-13", 3000))
        before, _ = collector.build_instrument(KR_INDEX, "yfinance", raw, None, moment("2025-11-13T07:29:59Z"), sessions)
        after, _ = collector.build_instrument(KR_INDEX, "yfinance", raw, None, moment("2025-11-13T07:30:00Z"), sessions)
        self.assertEqual(before["value"], 2900)
        self.assertEqual(after["asOf"], "2025-11-13T07:30:00.000Z")
        with self.assertRaisesRegex(ValueError, "unconfirmed: 2026-11-19"):
            collector.build_instrument(KR_INDEX, "yfinance", rows(("2026-11-19", 3100)), None, moment("2026-11-19T20:00:00Z"), {})
        with self.assertRaisesRegex(ValueError, "requires review"):
            collector.exchange_sessions("kr", moment("2027-01-04T12:00:00Z"))

    def test_yahoo_request_dates_use_each_exchange_day_instead_of_new_york(self):
        # Monday morning in Asia is still Sunday in New York.
        calls = {}
        def ticker(symbol):
            def history(**kwargs):
                calls[symbol] = kwargs
                return Frame([])
            return SimpleNamespace(history=history)
        fake = SimpleNamespace(Ticker=ticker, set_tz_cache_location=lambda path: None)
        with tempfile.TemporaryDirectory() as cache, patch.dict(os.environ, {"MARKET_CACHE_DIR": cache}), patch.dict(sys.modules, {"yfinance": fake}):
            for instrument in [US_STOCK, HK_INDEX, KR_INDEX, JP_INDEX]:
                collector.fetch_yfinance(instrument, moment("2026-06-07T23:30:00Z"))
        self.assertEqual(calls["AAPL"]["end"], "2026-06-08")
        for symbol in ["^HSI", "^KS11", "^N225"]:
            self.assertEqual(calls[symbol]["end"], "2026-06-09")

    def test_calendar_failure_isolated_to_korea_and_one_schedule_built_per_market(self):
        seen = []
        def schedule(market, now):
            seen.append(market)
            if market == "kr":
                raise ValueError("Fixture unconfirmed KRX hours")
            return {date(2026, 6, 8): moment("2026-06-08T20:00:00Z")}
        def fetch(instrument, now):
            raw = rows(("2026-06-08", 100))
            return raw, raw if instrument["stock"] else None
        with patch.object(collector, "exchange_sessions", schedule), redirect_stderr(io.StringIO()):
            result = collector.collect("yfinance", fetch=fetch, clock=lambda: moment("2026-06-08T23:00:00Z"))
        self.assertEqual(seen, ["us", "hk", "kr", "jp"])
        self.assertEqual(len(result["quotes"]), 7)
        self.assertEqual([error["instrumentId"] for error in result["errors"]], ["kr-kospi"])


if __name__ == "__main__":
    unittest.main()
