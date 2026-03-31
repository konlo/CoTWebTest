import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import SECTION_NAMES
from app.prompt_store import PromptStore


class FakeUsage:
    input_tokens = 14
    output_tokens = 8
    total_tokens = 22


class FakeResponse:
    id = "resp_test_123"
    output_text = "Mocked model output"
    usage = FakeUsage()


class FakeResponsesAPI:
    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return FakeResponse()


class FakeChatCompletionUsage:
    prompt_tokens = 10
    completion_tokens = 6
    total_tokens = 16


class FakeChatCompletionMessage:
    content = "Mocked Gemini output"


class FakeChatCompletionChoice:
    message = FakeChatCompletionMessage()


class FakeChatCompletionsAPI:
    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return type(
            "FakeChatCompletionResponse",
            (),
            {
                "id": "chatcmpl_test_456",
                "choices": [FakeChatCompletionChoice()],
                "usage": FakeChatCompletionUsage(),
            },
        )()


class FakeOpenAIClient:
    def __init__(self, api_key: str, base_url: str = None):
        self.api_key = api_key
        self.base_url = base_url
        self.responses = FakeResponsesAPI()
        self.chat = type(
            "FakeChatAPI",
            (),
            {"completions": FakeChatCompletionsAPI()},
        )()


@pytest.fixture
def sample_settings(tmp_path: Path) -> Settings:
    data_root = tmp_path / "data"
    prompts_dir = tmp_path / "prompts"
    storage_dir = tmp_path / "storage"

    for section in SECTION_NAMES:
        (data_root / section).mkdir(parents=True, exist_ok=True)

    sample_payloads = {
        "basic_info": {"service": "billing", "severity": "high"},
        "ims_info": {"title": "IMS 333", "owner": "ops"},
        "host_info": {"hostname": "host-333", "cpu": 88},
        "initial_into": {"summary": "initial capture"},
        "dump_info": {"files": ["dump-a.log"]},
    }

    for section, payload in sample_payloads.items():
        (data_root / section / "SEPM1763-333.json").write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )

    (data_root / "basic_info" / "SEPM1763-444.json").write_text(
        json.dumps({"service": "search"}, ensure_ascii=False),
        encoding="utf-8",
    )
    (data_root / "ims_info" / "SEPM1763-444.json").write_text(
        json.dumps({"title": "IMS 444"}, ensure_ascii=False),
        encoding="utf-8",
    )

    (prompts_dir / "base").mkdir(parents=True, exist_ok=True)
    (prompts_dir / "base" / "system.md").write_text(
        "System {{ ims_no }}",
        encoding="utf-8",
    )
    (prompts_dir / "base" / "user.md").write_text(
        "User {{ ims_info.title }} / {{ basic_info.service }}",
        encoding="utf-8",
    )

    return Settings(
        _env_file=None,
        DATA_ROOT=data_root,
        PROMPTS_DIR=prompts_dir,
        STORAGE_DIR=storage_dir,
        LLM_PROVIDER="openai",
        OPENAI_API_KEY="test-key",
        OPENAI_MODEL="gpt-test",
        GOOGLE_API_KEY=None,
    )


@pytest.fixture
def prompt_store(sample_settings: Settings) -> PromptStore:
    return PromptStore(sample_settings)


@pytest.fixture
def fake_client_factory():
    clients = []

    def factory(api_key: str, base_url: str = None):
        client = FakeOpenAIClient(api_key=api_key, base_url=base_url)
        clients.append(client)
        return client

    factory.instances = clients
    return factory


@pytest.fixture
def client(sample_settings: Settings, fake_client_factory):
    app = create_app(
        settings=sample_settings,
        llm_service=None,
    )
    app.state.llm_service.client_factory = fake_client_factory
    app.state.llm_service._clients = {}
    return TestClient(app)
