# CoTWebTest

FastAPI 기반 CoT Prompt Lab입니다. IMS 번호별 JSON 데이터를 묶어 프롬프트를 수정하고, 렌더링하고, OpenAI API로 바로 테스트할 수 있습니다.

## Features

- `basic_info`, `ims_info`, `host_info`, `initial_into`, `dump_info` 폴더의 `SEPM1763-<ims_no>.json` 파일을 IMS 번호 기준으로 자동 번들링
- `system.md`, `user.md` 기본 프롬프트 로드 및 Web textarea 편집
- Jinja2 `StrictUndefined` 기반 프롬프트 렌더링과 에러 표시
- OpenAI Responses API 호출
- `LLM_PROVIDER=google` 설정 시 Gemini OpenAI compatibility 경로로 실행
- `storage/prompt_history.jsonl` append-only 프롬프트 이력 저장 및 재로드
- `Baseline`, `Visible CoT`, `Structured CoT` 프리셋 비교 UI
- 같은 IMS 입력으로 프롬프트 구조 차이에 따른 응답 형식과 품질 신호 비교

## Layout

```text
.
├── app/
├── data/
│   ├── basic_info/
│   ├── ims_info/
│   ├── host_info/
│   ├── initial_into/
│   └── dump_info/
├── prompts/base/
└── storage/
```

## Setup

1. 가상환경 생성
2. 의존성 설치
3. `.env.example` 를 복사해 `.env` 작성
4. `data/` 아래에 IMS JSON 파일 배치
5. 서버 실행

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload
```

브라우저에서 [http://127.0.0.1:8000](http://127.0.0.1:8000) 으로 접속합니다.

Gemini를 쓸 경우 `.env` 예시:

```env
LLM_PROVIDER=google
OPENAI_MODEL=gemini-2.5-flash
GOOGLE_API_KEY=...
```

## Prompt Variables

기본 템플릿과 편집 화면에서 아래 변수를 사용할 수 있습니다.

- `ims_no`
- `basic_info`
- `ims_info`
- `host_info`
- `initial_into`
- `dump_info`
- `bundle`

JSON 전체를 프롬프트에 넣고 싶으면 `{{ basic_info | to_pretty_json }}` 같은 형태로 사용할 수 있습니다.

## API

- `GET /api/ims`
- `GET /api/ims/{ims_no}`
- `GET /api/prompts/base`
- `GET /api/prompts/history`
- `GET /api/prompts/history/{id}`
- `POST /api/prompts/render`
- `POST /api/prompts/save`
- `POST /api/test/run`

## Tests

```bash
pytest
```
