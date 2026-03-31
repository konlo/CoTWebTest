import json
from datetime import datetime, timezone
from threading import Lock
from uuid import uuid4

from app.config import Settings
from app.models import (
    PromptHistoryRecord,
    PromptHistorySummary,
    PromptPair,
    SavePromptRequest,
)


class PromptStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = Lock()
        self.ensure_layout()

    def ensure_layout(self) -> None:
        self.settings.PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
        self.settings.system_prompt_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings.STORAGE_DIR.mkdir(parents=True, exist_ok=True)

    def load_base_prompts(self) -> PromptPair:
        system_template = ""
        user_template = ""

        if self.settings.system_prompt_path.exists():
            system_template = self.settings.system_prompt_path.read_text(
                encoding="utf-8"
            )
        if self.settings.user_prompt_path.exists():
            user_template = self.settings.user_prompt_path.read_text(encoding="utf-8")

        return PromptPair(
            system_template=system_template,
            user_template=user_template,
        )

    def _read_records(self):
        if not self.settings.prompt_history_path.exists():
            return []

        records = []
        with self.settings.prompt_history_path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    payload = json.loads(stripped)
                except json.JSONDecodeError as exc:
                    raise RuntimeError(
                        f"Invalid JSONL in prompt history at line {line_number}: {exc}"
                    ) from exc
                records.append(PromptHistoryRecord.model_validate(payload))
        return records

    def list_history(self):
        records = list(reversed(self._read_records()))
        return [
            PromptHistorySummary(
                id=record.id,
                saved_at=record.saved_at,
                title=record.title,
                ims_no=record.ims_no,
                model=record.model,
                notes=record.notes,
            )
            for record in records
        ]

    def get_record(self, record_id: str) -> PromptHistoryRecord:
        for record in reversed(self._read_records()):
            if record.id == record_id:
                return record
        raise KeyError(record_id)

    def get_latest_record(self):
        records = self._read_records()
        if not records:
            return None
        return records[-1]

    def save_record(
        self,
        request: SavePromptRequest,
        source_files,
    ) -> PromptHistoryRecord:
        now = datetime.now(timezone.utc)
        title = request.title.strip() or now.strftime("Prompt %Y-%m-%d %H:%M:%S")
        record = PromptHistoryRecord(
            id=uuid4().hex,
            saved_at=now.isoformat(),
            title=title,
            ims_no=request.ims_no,
            system_template=request.system_template,
            user_template=request.user_template,
            model=request.model,
            notes=request.notes,
            source_files=source_files,
        )

        with self._lock:
            self.settings.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
            with self.settings.prompt_history_path.open(
                "a", encoding="utf-8"
            ) as handle:
                handle.write(
                    json.dumps(record.model_dump(mode="json"), ensure_ascii=False)
                )
                handle.write("\n")

        return record
