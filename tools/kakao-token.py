#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
카카오톡 알림용 '리프레시 토큰' 발급 도우미 (처음 한 번만 실행)

사용법:   py tools/kakao-token.py
순서:     REST API 키, Client Secret 입력 → 열리는 카카오 로그인 화면에서 동의
          → 이동한 페이지 주소창의 전체 주소를 복사해서 붙여넣기
          → 화면에 나온 리프레시 토큰을 GitHub Secret(KAKAO_REFRESH_TOKEN)에 넣기
          → 카카오톡으로 시험 메시지가 한 통 와요

필요한 것: 파이썬만 있으면 돼요 (따로 설치할 것 없음)
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

# 카카오 개발자 콘솔의 Redirect URI 에 이 주소를 등록해 두어야 해요. (아무 화면도 안 떠도 괜찮아요)
REDIRECT_URI = "https://example.com/oauth"
FORM = {"Content-Type": "application/x-www-form-urlencoded;charset=utf-8"}


def post(url, fields, headers=None):
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={**FORM, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        print("\n카카오가 거절했어요 (HTTP %d): %s" % (e.code, body))
        hints = {
            "KOE006": "Redirect URI 가 등록되어 있지 않아요 → 카카오 로그인 > Redirect URI 에 %s 등록" % REDIRECT_URI,
            "KOE101": "REST API 키가 올바르지 않아요",
            "KOE010": "Client Secret 이 맞지 않아요",
            "KOE320": "인가 코드가 이미 쓰였어요. 처음부터 다시 실행해 주세요",
            "-402": "동의항목에서 '카카오톡 메시지 전송(talk_message)'을 켜고, 로그인할 때 동의해야 해요",
        }
        for code, hint in hints.items():
            if code in body:
                print("→", hint)
        sys.exit(1)


def main():
    print("카카오톡 알림 토큰 발급 도우미\n")
    rest_key = input("REST API 키: ").strip()
    secret = input("Client Secret: ").strip()
    if not rest_key or not secret:
        print("두 값을 모두 입력해 주세요.")
        return 1

    url = "https://kauth.kakao.com/oauth/authorize?" + urllib.parse.urlencode({
        "client_id": rest_key,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": "talk_message",
    })
    print("\n브라우저에서 카카오 로그인 화면이 열립니다. 로그인하고 '동의하고 계속하기'를 누르세요.")
    print("(안 열리면 아래 주소를 복사해서 브라우저에 붙여넣으세요)\n%s\n" % url)
    webbrowser.open(url)

    print("로그인 뒤 example.com 으로 이동해요. 페이지 내용은 상관없고, 주소창의 '전체 주소'를 복사해 주세요.")
    print("(주소 안에 ?code=… 가 들어 있어요)")
    pasted = input("\n붙여넣기: ").strip()
    query = urllib.parse.parse_qs(urllib.parse.urlparse(pasted).query)
    code = (query.get("code") or [""])[0]
    if not code:
        print("주소에서 code 를 찾지 못했어요. 주소 전체를 복사했는지 확인해 주세요.")
        return 1

    tokens = post("https://kauth.kakao.com/oauth/token", {
        "grant_type": "authorization_code",
        "client_id": rest_key,
        "client_secret": secret,
        "redirect_uri": REDIRECT_URI,
        "code": code,
    })
    refresh = tokens.get("refresh_token")
    access = tokens.get("access_token")
    if not refresh or not access:
        print("토큰을 받지 못했어요:", tokens)
        return 1

    post("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
        "template_object": json.dumps({
            "object_type": "text",
            "text": "카카오톡 알림 연결 시험입니다. 이 메시지가 보이면 성공이에요!",
            "link": {"web_url": "https://www.kakao.com", "mobile_web_url": "https://www.kakao.com"},
        }, ensure_ascii=False),
    }, {"Authorization": "Bearer " + access})

    print("\n카카오톡 '나와의 채팅'에 시험 메시지를 보냈어요. 확인해 보세요.\n")
    print("=" * 60)
    print("KAKAO_REFRESH_TOKEN 에 넣을 값 (이 값은 남에게 보여주지 마세요):\n")
    print(refresh)
    print("=" * 60)
    print("\n다음: GitHub 저장소 Settings > Secrets and variables > Actions 에 넣기 (README 5장)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n중단했어요.")
        sys.exit(1)
