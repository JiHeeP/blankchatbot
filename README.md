# 지형 탐험 도우미

원안의 흐름을 바탕으로 만든 다국어 지형 학습 챗봇입니다. 학생이 `모습 → 자원 → 하는 일` 순서로 질문하도록 유도하고, 실제 응답은 Moonshot의 `Kimi 2.5` 모델로 생성합니다.

## 구성

- `public/index.html`: 앱 진입 페이지
- `public/styles.css`: 반응형 UI 스타일
- `public/app.js`: 언어 선택, 지형 선택, 채팅 화면 로직
- `public/config.js`: 원안 데이터와 시스템 프롬프트 규칙
- `public/brand-mark.svg`, `public/favicon.svg`, `public/manifest.webmanifest`: 브랜딩 자산
- `server.js`: 정적 파일 제공 + Moonshot API 프록시 서버
- `logs/`: 대화 로그가 날짜별 JSONL 파일로 저장되는 폴더

## 주요 기능

- 언어 선택 → 지형 선택 → 대화 시작 흐름
- 브라우저 자동 저장으로 새로고침 후에도 대화 이어가기
- 대화 초기화 및 `.txt` 내보내기
- 서버 `logs` 폴더에 대화 기록 저장
- 배포용 `Dockerfile`과 `/api/health` 헬스체크 제공

## 실행 방법

1. Node.js 18 이상을 설치합니다.
2. 프로젝트 루트에서 `.env.example`을 복사해 `.env`로 만듭니다.
3. `.env` 안의 `MOONSHOT_API_KEY`를 실제 키로 바꿉니다.
4. 아래 명령으로 서버를 실행합니다.

```powershell
node server.js
```

5. 브라우저에서 `http://localhost:3000`을 엽니다.

`npm`을 쓸 수 있는 환경이라면 아래도 가능합니다.

```powershell
npm start
```

## 참고

- API 키는 브라우저에서 직접 쓰지 않고, 서버에서만 Moonshot API를 호출합니다.
- 기본 모델은 `kimi-k2.5`이며, `.env`에서 `MOONSHOT_MODEL`로 바꿀 수 있습니다.
- `kimi-k2.5` 테스트 기준 `temperature`는 `1`로 두는 것이 안전합니다.
- 현재 환경에서 Node.js 설치 후 로컬 서버 실행과 `/api/chat` 응답까지 확인했습니다.

## 배포

Docker를 쓴다면 아래처럼 실행할 수 있습니다.

```powershell
docker build -t terrain-explorer-chatbot .
docker run --env-file .env -p 3000:3000 terrain-explorer-chatbot
```

헬스체크 엔드포인트는 `http://localhost:3000/api/health` 입니다.
