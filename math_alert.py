#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
수학 연산 연습(mathpractice) 미실시 학생 알림

칠판 공지판이 이 모듈로 「이전 등교일에 분수 연산 마스터를 하지 않은 학생」을 받아 온다.

- 데이터: mathpractice 의 Firestore (반 코드만 알면 명단·기록을 읽을 수 있음)
- 등교일: 월~금에서 공휴일(대체공휴일 포함)과 '등교 안 하는 날'을 뺀 날
  '등교 안 하는 날'은 공지.txt 의 [등교 안 하는 날] 구역 + mathpractice 반 설정(offDays) 을 합친다.
- 인터넷이 안 되면 마지막으로 성공한 결과(수학_캐시.json)를 그대로 보여 준다.

Python 표준 라이브러리만 사용한다 (urllib, json).
"""

import datetime as dt
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

ONE_DAY = dt.timedelta(days=1)
WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]

# mathpractice 의 Firebase 웹 앱 설정 (공개되어도 되는 값 — 보안은 Firestore 규칙이 담당)
DEFAULT_PROJECT_ID = "mathpractice-1d8f9"
DEFAULT_API_KEY = "AIzaSyD-0OnV9CfNbglUojNh1Sz-WpVzZImereY"

# [수학 설정] 기본값
DEFAULT_SETTINGS = {
    "갱신": "30",                 # 몇 분마다 다시 받아올지
    "구역이름": "어제 수학 안 한 사람",
    "기준": "아무거나",           # 아무거나 = 연습·도전 아무 기록이나 / 도전 = 도전 기록만
    "프로젝트": DEFAULT_PROJECT_ID,
    "API키": DEFAULT_API_KEY,
}

FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents"
TIMEOUT_SEC = 15

# ----------------------------------------------------------------------------
# 등교일 판단 (mathpractice 의 js/schoolday.js 와 같은 규칙)
# ----------------------------------------------------------------------------

# 날짜가 고정된 공휴일 — (월-일, 토·일과 겹칠 때 대체공휴일 적용 여부)
FIXED_HOLIDAYS = [
    ("01-01", False),   # 신정 (대체공휴일 없음)
    ("03-01", True),    # 3·1절
    ("05-05", True),    # 어린이날
    ("06-06", False),   # 현충일 (대체공휴일 없음)
    ("08-15", True),    # 광복절
    ("10-03", True),    # 개천절
    ("10-09", True),    # 한글날
    ("12-25", True),    # 성탄절
]

_holiday_cache = {}


def public_holidays(year):
    """해당 연도의 고정 공휴일 + 대체공휴일 집합(date)."""
    if year in _holiday_cache:
        return _holiday_cache[year]
    days = set()
    for md, _ in FIXED_HOLIDAYS:
        days.add(dt.date(year, int(md[:2]), int(md[3:])))
    for md, substitute in FIXED_HOLIDAYS:
        if not substitute:
            continue
        d = dt.date(year, int(md[:2]), int(md[3:]))
        if d.weekday() < 5:
            continue
        s = d + ONE_DAY
        while s.weekday() >= 5 or s in days:
            s += ONE_DAY
        days.add(s)
    _holiday_cache[year] = days
    return days


def parse_date(text):
    """2026-09-01, 2026.9.1, 2026/9/1, 2026년 9월 1일 → date. 못 읽으면 None."""
    m = re.search(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", str(text or ""))
    if not m:
        return None
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def parse_off_days(lines):
    """줄 목록에서 날짜만 골라 date 목록으로. '#' 뒤는 메모."""
    out = set()
    for line in lines or []:
        line = str(line).split("#", 1)[0].strip()
        if not line:
            continue
        d = parse_date(line)
        if d:
            out.add(d)
    return sorted(out)


class SchoolCalendar:
    def __init__(self, off_days=()):
        self.off_days = set(off_days)

    def is_school_day(self, day):
        return (day.weekday() < 5
                and day not in public_holidays(day.year)
                and day not in self.off_days)

    def prev_school_day(self, day):
        """day 보다 앞선 가장 가까운 등교일 (당일 제외). 없으면 None."""
        for _ in range(120):
            day -= ONE_DAY
            if self.is_school_day(day):
                return day
        return None

    def why_off(self, day):
        """등교하지 않는 이유. 등교일이면 빈 문자열."""
        if day.weekday() >= 5:
            return "주말"
        if day in public_holidays(day.year):
            return "공휴일"
        if day in self.off_days:
            return "등교 안 하는 날"
        return ""


def date_key(day):
    return day.strftime("%Y-%m-%d")


def label(day):
    return "%d/%d (%s)" % (day.month, day.day, WEEKDAY_KO[day.weekday()])


# ----------------------------------------------------------------------------
# Firestore REST 읽기
# ----------------------------------------------------------------------------

class FetchError(Exception):
    pass


def _short_error(e):
    if isinstance(e, urllib.error.HTTPError):
        if e.code == 429:
            return "Firestore 사용량 초과 (HTTP 429)"
        if e.code in (401, 403):
            return "Firestore 접근 거부 (HTTP %d)" % e.code
        if e.code == 404:
            return "반 코드를 찾을 수 없음 (HTTP 404)"
        return "HTTP %d" % e.code
    if isinstance(e, urllib.error.URLError):
        return "인터넷 연결 안 됨"
    return str(e) or e.__class__.__name__


def _value(v):
    """Firestore 값 객체 → 파이썬 값."""
    if not isinstance(v, dict):
        return None
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "booleanValue" in v:
        return v["booleanValue"]
    if "nullValue" in v:
        return None
    if "arrayValue" in v:
        return [_value(x) for x in (v["arrayValue"].get("values") or [])]
    if "mapValue" in v:
        return {k: _value(x) for k, x in (v["mapValue"].get("fields") or {}).items()}
    return None


def _fields(doc):
    return {k: _value(v) for k, v in (doc.get("fields") or {}).items()}


class MathPracticeClient:
    def __init__(self, class_code, project_id=DEFAULT_PROJECT_ID, api_key=DEFAULT_API_KEY, opener=None):
        self.class_code = str(class_code).strip().upper()
        self.project_id = project_id or DEFAULT_PROJECT_ID
        self.api_key = api_key or ""
        self.base = FIRESTORE_BASE % self.project_id
        self._open = opener or self._default_open

    # -- HTTP -------------------------------------------------------------

    def _default_open(self, url, body=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"},
                                     method="POST" if body is not None else "GET")
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _url(self, path, **params):
        if self.api_key:
            params["key"] = self.api_key
        q = urllib.parse.urlencode(params)
        return "%s/%s%s" % (self.base, path, ("?" + q) if q else "")

    def _call(self, path, body=None, **params):
        try:
            return self._open(self._url(path, **params), body)
        except Exception as e:  # noqa: BLE001 — 화면에는 짧은 이유만 보여 준다
            raise FetchError(_short_error(e))

    # -- 읽기 -------------------------------------------------------------

    def fetch_class(self):
        """반 문서 → {'name', 'offDays': [date], 'archived'}. 없으면 None."""
        try:
            doc = self._call("classes/%s" % urllib.parse.quote(self.class_code))
        except FetchError as e:
            if "404" in str(e):
                return None
            raise
        f = _fields(doc)
        return {
            "name": f.get("name") or "",
            "archived": bool(f.get("archived")),
            "offDays": parse_off_days(f.get("offDays") or []),
        }

    def fetch_students(self):
        """학생 명단 → [(번호, 이름)] 번호순."""
        out = []
        token = None
        while True:
            params = {"pageSize": 300}
            if token:
                params["pageToken"] = token
            res = self._call("classes/%s/students" % urllib.parse.quote(self.class_code), **params)
            for doc in res.get("documents") or []:
                f = _fields(doc)
                number = str(f.get("number") or doc["name"].rsplit("/", 1)[-1])
                out.append((number, str(f.get("name") or "")))
            token = res.get("nextPageToken")
            if not token:
                break
        return sorted(out, key=lambda s: (_num_key(s[0]), s[0]))

    def fetch_done(self, key, challenge_only=False):
        """key(YYYY-MM-DD) 날짜에 기록이 있는 학생 번호 집합."""
        body = {"structuredQuery": {
            "from": [{"collectionId": "results"}],
            "where": {"fieldFilter": {
                "field": {"fieldPath": "dateKey"}, "op": "EQUAL", "value": {"stringValue": key}}},
            "limit": 5000,
        }}
        res = self._call("classes/%s:runQuery" % urllib.parse.quote(self.class_code), body)
        done = set()
        for row in res or []:
            doc = row.get("document")
            if not doc:
                continue
            f = _fields(doc)
            if challenge_only and f.get("mode") != "challenge":
                continue
            if f.get("studentNo") is not None:
                done.add(str(f["studentNo"]))
        return done


def _num_key(s):
    try:
        return (0, int(s))
    except ValueError:
        return (1, 0)


# ----------------------------------------------------------------------------
# 한 번의 조회 = 반 설정 + 명단 + 이전 등교일 기록
# ----------------------------------------------------------------------------

def build_report(class_code, settings=None, local_off_days=(), today=None, client=None):
    """이전 등교일에 수학을 하지 않은 학생 목록을 만든다.

    반환: {
      'ok': True, 'class_code', 'class_name', 'date_key', 'date_label',
      'missing': [(번호, 이름)], 'done': n, 'total': n, 'fetched_at': 'HH:MM',
      'today_off': '주말' | '' ,
    }
    실패하면 FetchError 를 던진다.
    """
    cfg = dict(DEFAULT_SETTINGS)
    cfg.update({k: v for k, v in (settings or {}).items() if v})
    today = today or dt.date.today()
    client = client or MathPracticeClient(class_code, cfg.get("프로젝트"), cfg.get("API키"))

    cls = client.fetch_class()
    if cls is None:
        raise FetchError("반 코드 '%s' 를 찾을 수 없음" % client.class_code)
    cal = SchoolCalendar(set(local_off_days) | set(cls["offDays"]))
    prev = cal.prev_school_day(today)
    if prev is None:
        raise FetchError("이전 등교일을 찾을 수 없음")

    students = client.fetch_students()
    done = client.fetch_done(date_key(prev), challenge_only=(cfg.get("기준", "").strip() == "도전"))
    missing = [(no, name) for no, name in students if no not in done]
    return {
        "ok": True,
        "class_code": client.class_code,
        "class_name": cls["name"],
        "date_key": date_key(prev),
        "date_label": label(prev),
        "missing": missing,
        "done": len(students) - len(missing),
        "total": len(students),
        "fetched_at": dt.datetime.now().strftime("%H:%M"),
        "fetched_date": date_key(today),
        "today_off": cal.why_off(today),
    }


# ----------------------------------------------------------------------------
# 캐시 (인터넷이 안 될 때 마지막 결과를 보여 주기 위해)
# ----------------------------------------------------------------------------

def load_cache(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and data.get("ok") and "missing" in data:
            data["missing"] = [tuple(x) for x in data["missing"]]
            return data
    except (OSError, ValueError):
        pass
    return None


def save_cache(path, report):
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    except OSError:
        pass


# ----------------------------------------------------------------------------
# 표시용 문장
# ----------------------------------------------------------------------------

def format_names(missing, per_line=4):
    """[(번호, 이름)] → ['3번 김철수 · 7번 이영희 · ...', ...] 줄 목록."""
    items = ["%s번 %s" % (no, name) if name else "%s번" % no for no, name in missing]
    return [" · ".join(items[i:i + per_line]) for i in range(0, len(items), per_line)]


if __name__ == "__main__":
    # 명령줄 확인용:  python math_alert.py 반코드
    import sys
    if len(sys.argv) < 2:
        print("사용법: python math_alert.py 반코드")
        sys.exit(1)
    try:
        r = build_report(sys.argv[1])
    except FetchError as e:
        print("실패:", e)
        sys.exit(2)
    print("%s — %s 기준, %d명 중 %d명 안 함" % (r["class_name"], r["date_label"], r["total"], len(r["missing"])))
    for line in format_names(r["missing"]):
        print("  ", line)
