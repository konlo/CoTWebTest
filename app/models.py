from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


SECTION_NAMES = (
    "basic_info",
    "ims_info",
    "host_info",
    "initial_info",
    "dump_info",
    "refer_info",
)


class IMSListItem(BaseModel):
    ims_no: str
    available_sections: List[str]
    missing_sections: List[str]
    source_files: Dict[str, str]


class IMSBundle(BaseModel):
    ims_no: str
    basic_info: Optional[Any] = None
    ims_info: Optional[Any] = None
    host_info: Optional[Any] = None
    initial_info: Optional[Any] = None
    dump_info: Optional[Any] = None
    refer_info: Optional[Any] = None
    source_files: Dict[str, str] = Field(default_factory=dict)
    missing_sections: List[str] = Field(default_factory=list)


class PromptPair(BaseModel):
    system_template: str
    user_template: str


class PromptHistoryRecord(BaseModel):
    id: str
    saved_at: str
    title: str
    ims_no: str
    system_template: str
    user_template: str
    model: Optional[str] = None
    notes: str = ""
    source_files: Dict[str, str] = Field(default_factory=dict)


class PromptHistorySummary(BaseModel):
    id: str
    saved_at: str
    title: str
    ims_no: str
    model: Optional[str] = None
    notes: str = ""


class RenderRequest(BaseModel):
    ims_no: str
    system_template: str
    user_template: str


class RenderResponse(BaseModel):
    rendered_system: str
    rendered_user: str
    render_errors: Dict[str, str] = Field(default_factory=dict)


class SavePromptRequest(BaseModel):
    ims_no: str
    title: str = ""
    system_template: str
    user_template: str
    model: Optional[str] = None
    notes: str = ""


class UsageInfo(BaseModel):
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None


class RunTestRequest(BaseModel):
    ims_no: str
    system_template: str
    user_template: str
    model: Optional[str] = None
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_output_tokens: int = Field(default=1200, ge=1, le=8192)


class RunTestResponse(BaseModel):
    rendered_system: str
    rendered_user: str
    output_text: str = ""
    usage: Optional[UsageInfo] = None
    latency_ms: Optional[int] = None
    provider_request_id: Optional[str] = None
    error: Optional[str] = None
    render_errors: Dict[str, str] = Field(default_factory=dict)

class SaveSummaryRequest(BaseModel):
    ims_no: str
    run_type: str
    output_text: str

class AuditSaveRequest(BaseModel):
    ims_no: str
    system_template: str
    user_template: str

class AuditHistoryRecord(BaseModel):
    id: str
    saved_at: str
    ims_no: str
    system_template: str
    user_template: str
    refer_info: str
    generated_summary: str
    audit_score: float
    audit_explanation: str = ""
    semantic: int = 0
    keyword: int = 0
    structure: int = 0
    intent: int = 0
    latency_ms: Optional[int] = None
