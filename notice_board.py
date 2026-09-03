#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
칠판 공지판 (바탕화면 알림판)

- 바탕화면에 붙어 있는 학급 알림판입니다.
  다른 프로그램 창을 띄우면 가려지고, 바탕화면을 보면 다시 보입니다.
- 같은 폴더의 `공지.txt` 파일을 메모장으로 고치고 저장하면 몇 초 안에 화면이 바뀝니다.
- 우유 순서는 시작일과 순서 목록만 적어 두면 평일마다 자동으로 넘어갑니다.

실행:   pythonw notice_board.py        (또는 공지판_실행.bat 더블클릭)
옵션:   --autostart          윈도우 시작 시 자동 실행 등록
        --autostart-remove   자동 실행 해제
        --window             바탕화면에 붙이지 않고 보통 창으로 띄우기 (문제 확인용)
"""

import ctypes
import datetime as dt
import os
import re
import subprocess
import sys
import traceback

import tkinter as tk
import tkinter.font as tkfont

IS_WINDOWS = sys.platform.startswith("win")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "공지.txt")
ERROR_LOG = os.path.join(BASE_DIR, "공지판_오류.txt")
LOG_PATH = os.path.join(BASE_DIR, "공지판_로그.txt")
APP_NAME = "칠판공지판"

ONE_DAY = dt.timedelta(days=1)
WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]

# 화면에 목록으로 표시하지 않는 특수 구역
RESERVED_SECTIONS = {"제목", "우유 순서", "우유 시작일", "우유 쉬는 날", "창"}

DEFAULT_WINDOW = {
    "위치": "오른쪽 위",
    "너비": "560",
    "높이": "자동",
    "여백": "24",
    "글자크기": "22",
    "모니터": "1",
    "배경색": "#1f2937",
    "글자색": "#f9fafb",
    "보조색": "#cbd5e1",
    "강조색": "#fbbf24",
    "투명도": "1",
}

SAMPLE_CONFIG = """# ===============================================
#  칠판 공지판 설정 파일
#  - [대괄호] 줄은 구역 이름입니다.
#  - '#'으로 시작하는 줄은 설명이라서 화면에 나오지 않습니다.
#  - 저장하면 공지판이 몇 초 안에 자동으로 바뀝니다.
#  - 구역은 마음대로 추가해도 됩니다. (예: [이번 주 청소], [준비물])
# ===============================================

[제목]
5학년 4반 알림판

[우유 순서]
# 위에서부터 차례대로, 평일(월~금)마다 한 칸씩 넘어갑니다.
1모둠
2모둠
3모둠
4모둠
5모둠

[우유 시작일]
# 이 날짜에 맨 위 당번이 시작합니다. (연-월-일)
2026-09-01

[우유 쉬는 날]
# 우유가 안 나오는 날(공휴일, 행사). 이 날은 순서가 넘어가지 않습니다.
2026-09-24
2026-09-25
2026-10-05
2026-10-09
2026-12-25

[오늘 할 일]
- 알림장 쓰기
- 급식 후 양치하기
- 5교시 전 책상 정리

[잊지 말기]
# 줄 앞에 '!'를 붙이면 강조색으로 표시됩니다.
! 9월 5일(금)까지 현장체험학습 신청서 내기
- 목요일 체육복 챙기기
- 도서관 책 반납

[창]
# 위치: 오른쪽 위 / 오른쪽 아래 / 왼쪽 위 / 왼쪽 아래 / 가운데
#       또는 숫자 두 개로 직접 지정 (예: 1200,80)
# 높이: 자동 또는 숫자
# 모니터: 1 = 주 모니터, 2 = 두 번째 모니터
위치 = 오른쪽 위
너비 = 560
높이 = 자동
글자크기 = 22
모니터 = 1
배경색 = #1f2937
글자색 = #f9fafb
보조색 = #cbd5e1
강조색 = #fbbf24
투명도 = 1
"""


def log(message):
    """진단용 기록. 실행할 때마다 공지판_로그.txt에 남긴다."""
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write("%s  %s\n" % (dt.datetime.now().strftime("%H:%M:%S"), message))
    except OSError:
        pass


# ----------------------------------------------------------------------------
# 설정 파일 읽기
# ----------------------------------------------------------------------------

def read_text_file(path):
    """UTF-8(BOM 포함) 또는 한국어 윈도우 기본 인코딩(cp949) 파일을 읽는다."""
    with open(path, "rb") as f:
        raw = f.read()
    for enc in ("utf-8-sig", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def ensure_config_exists():
    if not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "w", encoding="utf-8-sig", newline="\r\n") as f:
            f.write(SAMPLE_CONFIG)


def parse_config(text):
    """구역 이름 -> 줄 목록. 구역 순서도 같이 돌려준다."""
    sections = {}
    order = []
    current = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.fullmatch(r"\[(.+?)\]", line)
        if m:
            current = m.group(1).strip()
            if current not in sections:
                sections[current] = []
                order.append(current)
            continue
        if current is None:
            continue
        sections[current].append(line)
    return sections, order


def parse_window_settings(lines):
    cfg = dict(DEFAULT_WINDOW)
    for line in lines:
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if value:
            cfg[key] = value
    return cfg


def parse_date(text):
    """2026-09-01, 2026.9.1, 2026/9/1 같은 형식을 날짜로 바꾼다."""
    m = re.search(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", text)
    if not m:
        return None
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def to_int(value, default):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def to_float(value, default):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


# ----------------------------------------------------------------------------
# 우유 당번 계산
# ----------------------------------------------------------------------------

class MilkSchedule:
    def __init__(self, names, start, off_days):
        self.names = [n for n in names if n]
        self.start = start
        self.off_days = set(off_days)

    @property
    def ready(self):
        return bool(self.names) and self.start is not None

    def is_school_day(self, day):
        return day.weekday() < 5 and day not in self.off_days

    def next_school_day(self, day):
        """day 당일을 포함해서 가장 가까운 등교일."""
        for _ in range(120):
            if self.is_school_day(day):
                return day
            day += ONE_DAY
        return None

    def duty_on(self, day):
        """등교일 day의 당번. 시작일보다 앞이면 None."""
        if not self.ready or day < self.start:
            return None
        count = 0
        cur = self.start
        while cur < day:
            if self.is_school_day(cur):
                count += 1
            cur += ONE_DAY
        return self.names[count % len(self.names)]

    def summary(self, today):
        """(오늘 줄, 다음 줄) 형태의 표시용 문장을 만든다."""
        if not self.ready:
            return None
        if today < self.start:
            first = self.names[0]
            return ("%d월 %d일부터 시작" % (self.start.month, self.start.day),
                    "첫 당번: %s" % first)

        if self.is_school_day(today):
            today_duty = self.duty_on(today)
            nxt = self.next_school_day(today + ONE_DAY)
            next_line = ""
            if nxt:
                label = "내일" if nxt == today + ONE_DAY else "다음 등교일(%s)" % WEEKDAY_KO[nxt.weekday()]
                next_line = "%s: %s" % (label, self.duty_on(nxt))
            return ("오늘: %s" % today_duty, next_line)

        nxt = self.next_school_day(today)
        if not nxt:
            return None
        return ("오늘은 우유 없음",
                "다음 등교일(%s): %s" % (WEEKDAY_KO[nxt.weekday()], self.duty_on(nxt)))


# ----------------------------------------------------------------------------
# 윈도우 바탕화면에 붙이기
# ----------------------------------------------------------------------------

if IS_WINDOWS:
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
    user32.FindWindowW.restype = wintypes.HWND
    user32.FindWindowExW.argtypes = [wintypes.HWND, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR]
    user32.FindWindowExW.restype = wintypes.HWND
    user32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
    user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetParent.argtypes = [wintypes.HWND]
    user32.GetParent.restype = wintypes.HWND
    user32.SetParent.argtypes = [wintypes.HWND, wintypes.HWND]
    user32.SetParent.restype = wintypes.HWND
    user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    user32.GetWindow.restype = wintypes.HWND
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                    ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.ScreenToClient.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.WindowFromPoint.argtypes = [wintypes.POINT]
    user32.WindowFromPoint.restype = wintypes.HWND
    user32.IsChild.argtypes = [wintypes.HWND, wintypes.HWND]
    user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    user32.GetAncestor.restype = wintypes.HWND
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    if ctypes.sizeof(ctypes.c_void_p) == 8:
        _GetWindowLong = user32.GetWindowLongPtrW
        _SetWindowLong = user32.SetWindowLongPtrW
    else:
        _GetWindowLong = user32.GetWindowLongW
        _SetWindowLong = user32.SetWindowLongW
    _GetWindowLong.argtypes = [wintypes.HWND, ctypes.c_int]
    _GetWindowLong.restype = ctypes.c_ssize_t
    _SetWindowLong.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
    _SetWindowLong.restype = ctypes.c_ssize_t

    HWND_TOP = 0
    HWND_BOTTOM = 1
    SWP_NOSIZE = 0x0001
    SWP_NOMOVE = 0x0002
    SWP_NOACTIVATE = 0x0010
    SWP_SHOWWINDOW = 0x0040
    GW_HWNDPREV = 3
    SW_SHOWNOACTIVATE = 4
    GA_ROOT = 2
    GWL_STYLE = -16
    WS_CHILD = 0x40000000
    WS_POPUP = 0x80000000

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD),
                    ("rcMonitor", wintypes.RECT),
                    ("rcWork", wintypes.RECT),
                    ("dwFlags", wintypes.DWORD)]

    MONITORENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_int, wintypes.HMONITOR, wintypes.HDC,
                                         ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)

    def _class_name(hwnd):
        buf = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, buf, 256)
        return buf.value

    def find_desktop_host():
        """바탕화면 아이콘(SHELLDLL_DefView)을 담고 있는 창을 찾는다.

        Windows 10/11 버전에 따라 Progman 자신이거나, 최상위 WorkerW이거나,
        Progman 안의 WorkerW(24H2)일 수 있어서 셋 다 확인한다.
        """
        progman = user32.FindWindowW("Progman", None)
        candidates = []
        if progman:
            candidates.append(progman)
            child = user32.FindWindowExW(progman, None, "WorkerW", None)
            while child:
                candidates.append(child)
                child = user32.FindWindowExW(progman, child, "WorkerW", None)

        tops = []

        @WNDENUMPROC
        def _cb(hwnd, _lparam):
            if _class_name(hwnd) == "WorkerW":
                tops.append(hwnd)
            return True

        user32.EnumWindows(_cb, 0)
        candidates.extend(tops)

        for host in candidates:
            if user32.FindWindowExW(host, None, "SHELLDLL_DefView", None):
                return host
        return progman or None

    def monitor_work_areas():
        """모니터별 작업 영역(작업 표시줄 제외) 목록. 주 모니터가 먼저 온다."""
        areas = []

        @MONITORENUMPROC
        def _cb(hmon, _hdc, _rect, _lparam):
            info = MONITORINFO()
            info.cbSize = ctypes.sizeof(MONITORINFO)
            if user32.GetMonitorInfoW(hmon, ctypes.byref(info)):
                r = info.rcWork
                primary = bool(info.dwFlags & 1)
                areas.append((primary, (r.left, r.top, r.right, r.bottom)))
            return 1

        user32.EnumDisplayMonitors(None, None, _cb, 0)
        areas.sort(key=lambda a: not a[0])
        return [a[1] for a in areas]


class DesktopPin:
    """Tk 창을 바탕화면 창의 자식으로 붙여서 '바탕화면 위, 다른 창 아래'에 둔다."""

    def __init__(self, root):
        self.root = root
        self.hwnd = None
        self.host = None
        self.mode = "window"  # "desktop" | "bottom" | "window"

    def _resolve_hwnd(self):
        self.root.update_idletasks()
        child = self.root.winfo_id()
        parent = user32.GetParent(child)
        self.hwnd = parent or child

    def _set_child_style(self, child):
        """SetParent 전후로 WS_POPUP <-> WS_CHILD 스타일을 맞춘다 (MS 권장)."""
        style = _GetWindowLong(self.hwnd, GWL_STYLE)
        if child:
            style = (style & ~WS_POPUP) | WS_CHILD
        else:
            style = (style & ~WS_CHILD) | WS_POPUP
        _SetWindowLong(self.hwnd, GWL_STYLE, style)

    def attach(self, x, y, w, h):
        if not IS_WINDOWS:
            return "window"
        if self.hwnd is None:
            self._resolve_hwnd()
        host = find_desktop_host()
        log("붙이기 시도: 창=%s 바탕화면창=%s(%s)" % (
            self.hwnd, host, _class_name(host) if host else "-"))
        if host:
            if user32.GetParent(self.hwnd) != host:
                self._set_child_style(True)
                user32.SetParent(self.hwnd, host)
            self.host = host
            self.mode = "desktop"
            self.place(x, y, w, h)
            log("바탕화면 모드로 붙임 (%d,%d %dx%d) 표시=%s" % (
                x, y, w, h, bool(user32.IsWindowVisible(self.hwnd))))
        else:
            self._fallback_bottom(x, y, w, h)
        return self.mode

    def _fallback_bottom(self, x, y, w, h):
        """바탕화면 창에 못 붙이면 '항상 맨 아래 보통 창'으로 동작."""
        if self.host and self.hwnd:
            self._set_child_style(False)
            user32.SetParent(self.hwnd, None)
        self.host = None
        self.mode = "bottom"
        try:
            # 작업 표시줄에 안 보이게. Tk가 창을 새로 만들 수 있어서 핸들을 다시 얻는다.
            self.root.attributes("-toolwindow", True)
            self._resolve_hwnd()
        except tk.TclError:
            pass
        user32.SetWindowPos(self.hwnd, HWND_BOTTOM, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW)
        log("맨 아래 창 모드로 전환 (%d,%d %dx%d)" % (x, y, w, h))

    def covered_by_desktop(self):
        """창 가운데 지점을 찍어 봤을 때 바탕화면(아이콘)이 우리 창을 덮고 있으면 True."""
        if not IS_WINDOWS or self.hwnd is None or self.mode != "desktop":
            return False
        rect = wintypes.RECT()
        user32.GetWindowRect(self.hwnd, ctypes.byref(rect))
        pt = wintypes.POINT((rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2)
        found = user32.WindowFromPoint(pt)
        if not found or found == self.hwnd or user32.IsChild(self.hwnd, found):
            return False
        top = user32.GetAncestor(found, GA_ROOT)
        cls = _class_name(top)
        log("가려짐 검사: 그 자리 창=%s(%s) 최상위=%s" % (found, _class_name(found), cls))
        return cls in ("Progman", "WorkerW")

    def verify(self, x, y, w, h):
        """붙인 직후 한 번: 아이콘에 가려졌으면 위로 올리고, 그래도 안 되면 맨 아래 창 모드로."""
        if self.mode != "desktop":
            return
        if not self.covered_by_desktop():
            log("확인: 바탕화면 위에 정상 표시")
            return
        user32.SetWindowPos(self.hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
        self.root.update_idletasks()
        if self.covered_by_desktop():
            log("아이콘에 가려져서 맨 아래 창 모드로 바꿈")
            self._fallback_bottom(x, y, w, h)

    def place(self, x, y, w, h):
        if not IS_WINDOWS or self.hwnd is None:
            return
        if self.mode == "desktop" and self.host:
            pt = wintypes.POINT(x, y)
            user32.ScreenToClient(self.host, ctypes.byref(pt))
            user32.SetWindowPos(self.hwnd, HWND_TOP, pt.x, pt.y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW)
        else:
            user32.SetWindowPos(self.hwnd, HWND_BOTTOM, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW)

    def keep(self, x, y, w, h):
        """주기적으로 호출: 바탕화면 창이 바뀌었으면 다시 붙이고, 아이콘 위로 올린다."""
        if not IS_WINDOWS or self.hwnd is None:
            return
        current = user32.GetParent(self.root.winfo_id()) or self.root.winfo_id()
        if current != self.hwnd:
            # 창 속성이 바뀌면 Tk가 창을 새로 만들기도 한다. 그러면 처음부터 다시 붙인다.
            log("창 핸들이 바뀜: %s -> %s, 다시 붙임" % (self.hwnd, current))
            self.hwnd = None
            self.host = None
            self.attach(x, y, w, h)
            return
        if self.mode == "desktop":
            host = find_desktop_host()
            if host and host != self.host:
                log("바탕화면 창이 바뀜: %s -> %s, 다시 붙임" % (self.host, host))
                self.attach(x, y, w, h)
                return
            if user32.GetWindow(self.hwnd, GW_HWNDPREV):
                user32.SetWindowPos(self.hwnd, HWND_TOP, 0, 0, 0, 0,
                                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
        elif self.mode == "bottom":
            user32.SetWindowPos(self.hwnd, HWND_BOTTOM, 0, 0, 0, 0,
                                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)


# ----------------------------------------------------------------------------
# 화면
# ----------------------------------------------------------------------------

def pick_font_family():
    families = set(tkfont.families())
    for name in ("Malgun Gothic", "맑은 고딕", "Noto Sans CJK KR", "Noto Sans KR",
                 "NanumGothic", "Apple SD Gothic Neo", "WenQuanYi Zen Hei"):
        if name in families:
            return name
    return "TkDefaultFont"


class NoticeBoard:
    CONFIG_POLL_MS = 2000
    CLOCK_MS = 1000
    PIN_MS = 3000

    def __init__(self, root, force_window=False):
        self.root = root
        self.force_window = force_window
        self.pin = DesktopPin(root)
        self.font_family = pick_font_family()
        self.config_mtime = None
        self.sections = {}
        self.order = []
        self.win = dict(DEFAULT_WINDOW)
        self.milk = MilkSchedule([], None, [])
        self.today = dt.date.today()
        self.x = self.y = 0
        self.w = self.h = 100
        self.attached = False

        root.title(APP_NAME)
        root.overrideredirect(not force_window)
        root.resizable(False, False)

        self.frame = tk.Frame(root, bd=0, highlightthickness=0)
        self.frame.pack(fill="both", expand=True)

        self.load_config(initial=True)
        self.tick_clock()
        self.poll_config()
        if IS_WINDOWS and not force_window:
            self.root.after(500, self.attach_to_desktop)
            self.root.after(self.PIN_MS, self.poll_pin)

    # -- 설정 --------------------------------------------------------------

    def load_config(self, initial=False):
        ensure_config_exists()
        try:
            text = read_text_file(CONFIG_PATH)
            self.config_mtime = os.path.getmtime(CONFIG_PATH)
        except OSError:
            return
        self.sections, self.order = parse_config(text)
        self.win = parse_window_settings(self.sections.get("창", []))
        self.milk = MilkSchedule(
            self.sections.get("우유 순서", []),
            next((d for d in map(parse_date, self.sections.get("우유 시작일", [])) if d), None),
            [d for d in map(parse_date, self.sections.get("우유 쉬는 날", [])) if d],
        )
        self.build()
        self.apply_geometry()

    def poll_config(self):
        try:
            mtime = os.path.getmtime(CONFIG_PATH)
        except OSError:
            mtime = None
        if mtime != self.config_mtime:
            self.load_config()
        self.root.after(self.CONFIG_POLL_MS, self.poll_config)

    # -- 창 위치/크기 -------------------------------------------------------

    def _work_area(self):
        index = max(1, to_int(self.win.get("모니터"), 1)) - 1
        if IS_WINDOWS:
            areas = monitor_work_areas()
            if areas:
                return areas[min(index, len(areas) - 1)]
        return (0, 0, self.root.winfo_screenwidth(), self.root.winfo_screenheight())

    def apply_geometry(self):
        left, top, right, bottom = self._work_area()
        margin = max(0, to_int(self.win.get("여백"), 24))
        self.w = max(240, to_int(self.win.get("너비"), 560))

        height_setting = str(self.win.get("높이", "자동")).strip()
        if height_setting in ("", "자동", "auto"):
            self.root.update_idletasks()
            self.h = self.frame.winfo_reqheight()
        else:
            self.h = max(120, to_int(height_setting, 700))
        self.h = min(self.h, bottom - top - margin * 2)

        pos = str(self.win.get("위치", "오른쪽 위")).replace(" ", "")
        m = re.fullmatch(r"(-?\d+)[,x ](-?\d+)", pos)
        if m:
            self.x, self.y = int(m.group(1)), int(m.group(2))
        else:
            if "왼쪽" in pos:
                self.x = left + margin
            elif "가운데" in pos:
                self.x = left + (right - left - self.w) // 2
            else:
                self.x = right - self.w - margin
            if "아래" in pos:
                self.y = bottom - self.h - margin
            elif pos == "가운데":
                self.y = top + (bottom - top - self.h) // 2
            else:
                self.y = top + margin

        alpha = min(1.0, max(0.2, to_float(self.win.get("투명도"), 1.0)))
        try:
            self.root.attributes("-alpha", alpha)
        except tk.TclError:
            pass

        self.root.geometry("%dx%d+%d+%d" % (self.w, self.h, self.x, self.y))
        if self.attached:
            self.pin.place(self.x, self.y, self.w, self.h)

    def attach_to_desktop(self):
        mode = self.pin.attach(self.x, self.y, self.w, self.h)
        self.attached = True
        self.pin.place(self.x, self.y, self.w, self.h)
        self.mode = mode  # "desktop": 바탕화면에 붙음, "bottom": 맨 아래 창으로 유지
        self.root.after(1000, lambda: self.pin.verify(self.x, self.y, self.w, self.h))

    def poll_pin(self):
        self.pin.keep(self.x, self.y, self.w, self.h)
        self.root.after(self.PIN_MS, self.poll_pin)

    # -- 그리기 -------------------------------------------------------------

    def font(self, scale=1.0, bold=False):
        base = max(10, to_int(self.win.get("글자크기"), 22))
        return tkfont.Font(family=self.font_family, size=int(round(base * scale)),
                           weight="bold" if bold else "normal")

    def build(self):
        for child in self.frame.winfo_children():
            child.destroy()

        bg = self.win.get("배경색", "#1f2937")
        fg = self.win.get("글자색", "#f9fafb")
        sub = self.win.get("보조색", "#cbd5e1")
        accent = self.win.get("강조색", "#fbbf24")
        pad = 22
        width = max(240, to_int(self.win.get("너비"), 560))
        wrap = width - pad * 2 - 30

        self.frame.configure(bg=bg)
        body = tk.Frame(self.frame, bg=bg)
        body.pack(fill="both", expand=True, padx=pad, pady=(pad, 12))

        # 제목 + 날짜/시계
        title = " ".join(self.sections.get("제목", [])) or "학급 알림판"
        tk.Label(body, text=title, font=self.font(1.35, True), bg=bg, fg=fg,
                 anchor="w", justify="left", wraplength=wrap).pack(fill="x")
        self.clock_label = tk.Label(body, text="", font=self.font(0.85), bg=bg, fg=sub,
                                    anchor="w", justify="left")
        self.clock_label.pack(fill="x", pady=(2, 10))
        tk.Frame(body, bg=accent, height=3).pack(fill="x", pady=(0, 14))

        # 우유 당번
        milk = self.milk.summary(self.today)
        if milk:
            self._section_header(body, "우유 당번", bg, fg, accent)
            main_line, next_line = milk
            tk.Label(body, text=main_line, font=self.font(1.25, True), bg=bg, fg=accent,
                     anchor="w", justify="left", wraplength=wrap).pack(fill="x", padx=(16, 0))
            if next_line:
                tk.Label(body, text=next_line, font=self.font(0.85), bg=bg, fg=sub,
                         anchor="w", justify="left", wraplength=wrap).pack(fill="x", padx=(16, 0), pady=(0, 14))
            else:
                tk.Frame(body, bg=bg, height=14).pack()

        # 나머지 구역
        for name in self.order:
            if name in RESERVED_SECTIONS:
                continue
            lines = self.sections.get(name, [])
            if not lines:
                continue
            self._section_header(body, name, bg, fg, accent)
            for line in lines:
                important = line.startswith("!")
                text = line.lstrip("!-•·* ").strip()
                if not text:
                    continue
                tk.Label(body, text="• " + text, font=self.font(1.0, important), bg=bg,
                         fg=accent if important else fg, anchor="w", justify="left",
                         wraplength=wrap).pack(fill="x", padx=(16, 0), pady=1)
            tk.Frame(body, bg=bg, height=12).pack()

        # 하단 버튼
        footer = tk.Frame(self.frame, bg=bg)
        footer.pack(fill="x", padx=pad, pady=(0, 12))
        btn_font = self.font(0.6)
        for label, cmd in (("편집", self.open_editor), ("새로고침", self.load_config), ("닫기", self.quit)):
            tk.Button(footer, text=label, command=cmd, font=btn_font, bg=bg, fg=sub,
                      activebackground=bg, activeforeground=fg, relief="flat", bd=0,
                      highlightthickness=0, cursor="hand2", padx=8, pady=2).pack(side="right")

        self.update_clock_text()

    def _section_header(self, parent, text, bg, fg, accent):
        row = tk.Frame(parent, bg=bg)
        row.pack(fill="x", pady=(0, 6))
        tk.Frame(row, bg=accent, width=6).pack(side="left", fill="y", padx=(0, 10))
        tk.Label(row, text=text, font=self.font(0.95, True), bg=bg, fg=fg, anchor="w").pack(side="left")

    # -- 시계 ---------------------------------------------------------------

    def update_clock_text(self):
        now = dt.datetime.now()
        text = "%d년 %d월 %d일 %s요일   %02d:%02d" % (
            now.year, now.month, now.day, WEEKDAY_KO[now.weekday()], now.hour, now.minute)
        if getattr(self, "clock_label", None) and self.clock_label.winfo_exists():
            self.clock_label.configure(text=text)

    def tick_clock(self):
        today = dt.date.today()
        if today != self.today:
            self.today = today
            self.build()          # 날짜가 바뀌면 우유 당번을 다시 계산
            self.apply_geometry()
        else:
            self.update_clock_text()
        self.root.after(self.CLOCK_MS, self.tick_clock)

    # -- 동작 ---------------------------------------------------------------

    def open_editor(self):
        ensure_config_exists()
        try:
            if IS_WINDOWS:
                os.startfile(CONFIG_PATH)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", CONFIG_PATH])
            else:
                subprocess.Popen(["xdg-open", CONFIG_PATH])
        except OSError:
            pass

    def quit(self):
        self.root.destroy()


# ----------------------------------------------------------------------------
# 자동 실행 등록
# ----------------------------------------------------------------------------

def startup_bat_path():
    startup = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows",
                           "Start Menu", "Programs", "Startup")
    return os.path.join(startup, APP_NAME + ".bat")


def register_autostart():
    if not IS_WINDOWS:
        print("자동 실행 등록은 윈도우에서만 됩니다.")
        return 1
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    if not os.path.exists(pyw):
        pyw = sys.executable
    script = os.path.abspath(__file__)
    bat = startup_bat_path()
    content = '@echo off\r\ncd /d "%s"\r\nstart "" "%s" "%s"\r\n' % (BASE_DIR, pyw, script)
    os.makedirs(os.path.dirname(bat), exist_ok=True)
    with open(bat, "w", encoding="mbcs", newline="") as f:
        f.write(content)
    print("자동 실행 등록 완료:", bat)
    print("다음에 윈도우를 켜면 공지판이 자동으로 뜹니다.")
    return 0


def remove_autostart():
    bat = startup_bat_path()
    if os.path.exists(bat):
        os.remove(bat)
        print("자동 실행을 해제했습니다:", bat)
    else:
        print("등록된 자동 실행이 없습니다.")
    return 0


# ----------------------------------------------------------------------------

def main(argv):
    if "--autostart" in argv:
        return register_autostart()
    if "--autostart-remove" in argv:
        return remove_autostart()

    try:
        open(LOG_PATH, "w", encoding="utf-8").close()
    except OSError:
        pass
    log("시작: Python %s, %s, 옵션=%s" % (sys.version.split()[0], sys.platform, argv or "없음"))
    log("폴더: %s" % BASE_DIR)

    root = tk.Tk()
    NoticeBoard(root, force_window="--window" in argv)
    log("창 준비 완료, 화면 크기 %dx%d" % (root.winfo_screenwidth(), root.winfo_screenheight()))
    root.mainloop()
    log("종료")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception:
        # pythonw로 실행하면 오류가 안 보이므로 파일로 남긴다.
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write("=== %s ===\n" % dt.datetime.now())
            f.write(traceback.format_exc())
            f.write("\n")
        raise
