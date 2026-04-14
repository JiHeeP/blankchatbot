# 챗봇 메이커

Moonshot `Kimi` 모델을 이용해, 사용자가 원하는 목적에 맞는 챗봇을 설계하고 바로 테스트할 수 있는 웹 앱입니다.

기존의 특정 학습 내용 전용 챗봇 구조를 걷어내고, 아래 흐름으로 바꿨습니다.

1. 챗봇 의도와 참고 자료 입력
2. PDF 업로드 후 텍스트 추출 + 스캔본 OCR
3. AI가 `botConfig` 설계안 생성
4. 생성된 설계안 직접 수정
5. 같은 화면에서 테스트 대화
6. JSON 내보내기

## 주요 구조

- `public/index.html`: 앱 엔트리 페이지
- `public/styles.css`: 메이커 UI 스타일
- `public/app.js`: 기획 입력, 설계 편집, 테스트 채팅 UI 로직
- `public/pdf-tools.js`: PDF 텍스트 추출 및 브라우저 OCR 로직
- `public/config.js`: `botConfig` 정규화 및 런타임 시스템 프롬프트 생성
- `lib/chat-service.js`: Moonshot 호출, 설계 생성, 테스트 채팅 공용 로직
- `server.js`: 로컬 정적 서버 + API 라우팅
- `api/make-bot.js`: Vercel용 설계 생성 함수
- `api/chat.js`: Vercel용 테스트 채팅 함수
- `api/health.js`: 헬스 체크

## API

### `POST /api/make-bot`

사용자 의도와 참고 자료를 바탕으로 챗봇 설정을 생성합니다.

예시 요청:

```json
{
  "sessionId": "example-session",
  "brief": "고객지원 FAQ를 바탕으로 답하는 한국어 챗봇을 만들고 싶어.",
  "sourceText": "서비스 설명, 정책, FAQ 원문..."
}
```

예시 응답:

```json
{
  "botConfig": {
    "name": "고객지원 도우미",
    "tagline": "서비스 안내와 FAQ 응답을 담당하는 챗봇",
    "role": "고객 질문에 1차 응답하는 안내 도우미",
    "purpose": "FAQ 범위에서는 바로 답하고, 범위를 벗어나면 다음 절차를 안내한다",
    "targetAudience": "서비스 사용자",
    "language": "ko",
    "tone": "친절하고 명확한 톤",
    "responseStyle": "짧고 구조화된 안내",
    "greeting": "안녕하세요. 무엇을 도와드릴까요?",
    "knowledge": "핵심 정책과 FAQ 요약",
    "referenceText": "원문 자료",
    "mustDo": ["정확하게 안내한다"],
    "mustNotDo": ["없는 기능을 지어내지 않는다"],
    "starterQuestions": ["이 서비스는 무엇을 하나요?"]
  }
}
```

### `POST /api/chat`

생성된 `botConfig`를 시스템 프롬프트로 사용해 테스트 대화를 수행합니다.

## PDF 업로드 v1

- PDF 1개 업로드
- 최대 20MB, 최대 40페이지
- 브라우저에서 `pdfjs-dist`로 텍스트 추출
- 텍스트가 부족한 페이지는 `tesseract.js`로 OCR
- OCR 언어는 `kor + eng`
- 원본 PDF는 서버나 `localStorage`에 저장하지 않음
- 추출 텍스트만 `sourceText`에 반영

참고:

- OCR 첫 실행 시 브라우저가 OCR 코어/언어 데이터를 내려받을 수 있습니다.
- 최종 참고 자료는 최대 50,000자까지 반영됩니다.
- 길이를 초과하면 뒷부분이 잘리고 UI에 경고가 표시됩니다.

## 실행 방법

1. Node.js 18 이상을 설치합니다.
2. `.env.example`을 복사해 `.env`를 만듭니다.
3. `MOONSHOT_API_KEY`에 실제 키를 넣습니다.
4. 아래 명령으로 실행합니다.

```powershell
npm start
```

브라우저에서 `http://localhost:3010`을 열면 됩니다.

## 환경 변수

```text
MOONSHOT_API_KEY=...
MOONSHOT_MODEL=kimi-k2.5
MOONSHOT_TEMPERATURE=1
MOONSHOT_MAKER_TEMPERATURE=1
CHAT_LOGGING=off
LOG_DIR=logs
PORT=3010
```

설명:

- `MOONSHOT_TEMPERATURE`: 테스트 채팅용 temperature
- `MOONSHOT_MAKER_TEMPERATURE`: 설계 생성용 temperature
- `CHAT_LOGGING`: `off`, `console`, `file` 중 하나
- 기본값은 `off`이며, maker 성격상 대화 원문 대신 메타데이터만 기록하도록 설계했습니다.

## 현재 설계 포인트

- API 키는 브라우저로 전달하지 않고 서버에서만 사용합니다.
- 챗봇의 정체성은 `lang/terrain` 같은 고정 값이 아니라 `botConfig`로 정의됩니다.
- 설계 생성 결과는 화면에서 바로 수정할 수 있습니다.
- 테스트 대화와 설계안은 브라우저 `localStorage`에 저장됩니다.
- 원본 PDF는 저장하지 않고, 추출된 텍스트와 PDF 메타정보만 저장합니다.
- 서버 로그는 기본적으로 꺼져 있습니다.

## 로컬 검증 메모

다음 항목을 확인했습니다.

- `/api/health` 응답
- `/api/make-bot` 설계 생성
- `/api/chat` 테스트 응답
- `/`와 `/app.js` 정적 응답
- `/vendor/*` 정적 응답

검증은 로컬에서 `3010` 포트로 서버를 띄워 수행했습니다. 당시 `3000` 포트에서 실행 중이던 기존 프로세스는 건드리지 않았습니다.
