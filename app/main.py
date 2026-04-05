from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import Settings, get_settings
from app.data_repository import DataRepository
from app.llm import LLMService
from app.models import (
    IMSBundle,
    IMSListItem,
    PromptHistoryRecord,
    PromptHistorySummary,
    PromptPair,
)
from app.prompt_renderer import PromptRenderer
from app.prompt_store import PromptStore


def create_app(
    settings: Optional[Settings] = None,
    data_repository: Optional[DataRepository] = None,
    prompt_store: Optional[PromptStore] = None,
    prompt_renderer: Optional[PromptRenderer] = None,
    llm_service: Optional[LLMService] = None,
) -> FastAPI:
    app_settings = settings or get_settings()
    templates = Jinja2Templates(directory=str(app_settings.templates_dir))
    application = FastAPI(title=app_settings.APP_NAME)
    application.mount(
        "/static",
        StaticFiles(directory=str(app_settings.static_dir)),
        name="static",
    )

    application.state.settings = app_settings
    application.state.data_repository = data_repository or DataRepository(app_settings)
    application.state.prompt_store = prompt_store or PromptStore(app_settings)
    application.state.prompt_renderer = prompt_renderer or PromptRenderer()
    application.state.llm_service = llm_service or LLMService(app_settings)
    application.state.templates = templates

    # Import routers after state setup
    from app import gen_final_summary, compare_final_summary
    application.include_router(gen_final_summary.router)
    application.include_router(compare_final_summary.router)

    def load_bundle_or_404(ims_no: str) -> IMSBundle:
        try:
            return application.state.data_repository.load_bundle(ims_no)
        except KeyError as exc:
            raise HTTPException(
                status_code=404,
                detail=f"IMS {ims_no} was not found in the configured data directories.",
            ) from exc

    @application.get("/", response_class=HTMLResponse)
    async def index(request: Request):
        return RedirectResponse(url="/gen")

    @application.get("/api/ims", response_model=List[IMSListItem])
    async def list_ims():
        return application.state.data_repository.list_ims()

    @application.get("/api/ims/{ims_no}", response_model=IMSBundle)
    async def get_ims_bundle(ims_no: str):
        return load_bundle_or_404(ims_no)

    @application.get("/api/prompts/base", response_model=PromptPair)
    async def get_base_prompts():
        return application.state.prompt_store.load_base_prompts()

    @application.get(
        "/api/prompts/history",
        response_model=List[PromptHistorySummary],
    )
    async def list_prompt_history():
        return application.state.prompt_store.list_history()

    @application.get(
        "/api/prompts/history/{record_id}",
        response_model=PromptHistoryRecord,
    )
    async def get_prompt_history_record(record_id: str):
        try:
            return application.state.prompt_store.get_record(record_id)
        except KeyError as exc:
            raise HTTPException(
                status_code=404,
                detail=f"Prompt record {record_id} was not found.",
            ) from exc

    @application.post("/api/audit/batch/save")
    async def save_batch_audit_handler(payload: dict):
        import datetime
        import uuid
        import json
        
        batch_id = f"batch_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        data = {
            "id": batch_id,
            "saved_at": datetime.datetime.now().isoformat(),
            "avg_score": payload.get("avg_score"),
            "results": payload.get("results", []),
            "system_template": payload.get("system_template"),
            "user_template": payload.get("user_template")
        }
        
        batch_history_dir = application.state.settings.DATA_ROOT / "batch_audit_history"
        batch_history_dir.mkdir(parents=True, exist_ok=True)
        
        with open(batch_history_dir / f"{batch_id}.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        return {"id": batch_id}

    return application

app = create_app()
