from time import perf_counter
from typing import Callable, Dict, Optional

from app.config import Settings
from app.models import UsageInfo

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover
    OpenAI = None


class LLMService:
    def __init__(
        self,
        settings: Settings,
        client_factory: Optional[Callable[..., object]] = None,
    ) -> None:
        self.settings = settings
        self.client_factory = client_factory or OpenAI
        self._clients: Dict[str, object] = {}

    def _get_client(self, provider: str):
        if self.client_factory is None:
            raise RuntimeError(
                "The OpenAI SDK is not installed. Install dependencies before running tests."
            )
        if provider not in self._clients:
            if provider == "google":
                self._clients[provider] = self.client_factory(
                    api_key=self.settings.GOOGLE_API_KEY,
                    base_url=self.settings.GOOGLE_OPENAI_BASE_URL,
                )
            elif provider == "ollama":
                self._clients[provider] = self.client_factory(
                    api_key="ollama",
                    base_url=self.settings.OLLAMA_BASE_URL,
                )
            else:
                self._clients[provider] = self.client_factory(
                    api_key=self.settings.OPENAI_API_KEY
                )
        return self._clients[provider]

    @staticmethod
    def _extract_output_text(response) -> str:
        output_text = getattr(response, "output_text", "") or ""
        if output_text:
            return output_text

        fragments = []
        for item in getattr(response, "output", []) or []:
            for content in getattr(item, "content", []) or []:
                text_value = getattr(content, "text", "")
                if text_value:
                    fragments.append(text_value)
        return "\n".join(fragments)

    def run_test(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: Optional[str],
        temperature: float,
        max_output_tokens: int,
    ):
        provider = self.settings.resolved_llm_provider
        if provider == "ollama":
            selected_model = model or self.settings.OLLAMA_MODEL
        else:
            selected_model = model or self.settings.OPENAI_MODEL
        if not selected_model:
            raise RuntimeError("Model is not configured.")
        if provider == "google":
            if not self.settings.GOOGLE_API_KEY:
                raise RuntimeError("GOOGLE_API_KEY is not configured.")
        elif provider == "openai":
            if not self.settings.OPENAI_API_KEY:
                raise RuntimeError("OPENAI_API_KEY is not configured.")

        client = self._get_client(provider)
        started_at = perf_counter()
        if provider in {"google", "ollama"}:
            response = client.chat.completions.create(
                model=selected_model,
                temperature=temperature,
                max_tokens=max_output_tokens,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
        else:
            response = client.responses.create(
                model=selected_model,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                input=[
                    {
                        "role": "system",
                        "content": [{"type": "input_text", "text": system_prompt}],
                    },
                    {
                        "role": "user",
                        "content": [{"type": "input_text", "text": user_prompt}],
                    },
                ],
        )
        latency_ms = int((perf_counter() - started_at) * 1000)

        if provider in {"google", "ollama"}:
            usage = None
            if getattr(response, "usage", None) is not None:
                usage = UsageInfo(
                    input_tokens=getattr(response.usage, "prompt_tokens", None),
                    output_tokens=getattr(response.usage, "completion_tokens", None),
                    total_tokens=getattr(response.usage, "total_tokens", None),
                )

            output_text = ""
            choices = getattr(response, "choices", []) or []
            if choices:
                output_text = getattr(choices[0].message, "content", "") or ""

            return {
                "output_text": output_text,
                "usage": usage,
                "latency_ms": latency_ms,
                "provider_request_id": getattr(response, "id", None),
            }

        usage = None
        if getattr(response, "usage", None) is not None:
            usage = UsageInfo(
                input_tokens=getattr(response.usage, "input_tokens", None),
                output_tokens=getattr(response.usage, "output_tokens", None),
                total_tokens=getattr(response.usage, "total_tokens", None),
            )

        return {
            "output_text": self._extract_output_text(response),
            "usage": usage,
            "latency_ms": latency_ms,
            "provider_request_id": getattr(response, "id", None),
        }
