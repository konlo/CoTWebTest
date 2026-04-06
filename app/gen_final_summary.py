from typing import List
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse
from app.models import (
    IMSBundle, IMSListItem, PromptHistorySummary, PromptHistoryRecord,
    RenderRequest, RenderResponse, SavePromptRequest, RunTestRequest, RunTestResponse,
    SaveSummaryRequest
)
import json
import uuid

router = APIRouter()

def get_asset_version(app_settings):
    asset_paths = [
        app_settings.static_dir / "styles.css",
        app_settings.static_dir / "app.js",
    ]
    mtimes = [int(path.stat().st_mtime) for path in asset_paths if path.exists()]
    return max(mtimes) if mtimes else 0

@router.get("/gen", response_class=HTMLResponse)
async def gen_page(request: Request):
    app_settings = request.app.state.settings
    templates = request.app.state.templates
    if app_settings.resolved_llm_provider == "ollama":
        default_model = app_settings.OLLAMA_MODEL
    elif app_settings.resolved_llm_provider == "gpt-oss":
        default_model = app_settings.GPT_OSS_MODEL
    else:
        default_model = app_settings.OPENAI_MODEL
        
    return templates.TemplateResponse(
        request=request,
        name="gen.html",
        context={
            "app_name": f"{app_settings.APP_NAME} - Generator",
            "default_model": default_model or "",
            "asset_version": get_asset_version(app_settings),
        },
    )

@router.post("/api/prompts/render", response_model=RenderResponse)
async def render_prompts(payload: RenderRequest, request: Request):
    bundle = request.app.state.data_repository.load_bundle(payload.ims_no)
    rendered_system, rendered_user, render_errors = (
        request.app.state.prompt_renderer.render_pair(
            payload.system_template,
            payload.user_template,
            bundle,
        )
    )
    return RenderResponse(
        rendered_system=rendered_system,
        rendered_user=rendered_user,
        render_errors=render_errors,
    )

@router.post("/api/prompts/save", response_model=PromptHistoryRecord)
async def save_prompt(payload: SavePromptRequest, request: Request):
    bundle = request.app.state.data_repository.load_bundle(payload.ims_no)
    return request.app.state.prompt_store.save_record(
        payload,
        source_files=bundle.source_files,
    )

@router.post("/api/test/run", response_model=RunTestResponse)
async def run_test(payload: RunTestRequest, request: Request):
    bundle = request.app.state.data_repository.load_bundle(payload.ims_no)
    rendered_system, rendered_user, render_errors = (
        request.app.state.prompt_renderer.render_pair(
            payload.system_template,
            payload.user_template,
            bundle,
        )
    )

    if render_errors:
        return RunTestResponse(
            rendered_system=rendered_system,
            rendered_user=rendered_user,
            render_errors=render_errors,
            error="Prompt rendering failed.",
        )

    run_result = request.app.state.llm_service.run_test(
        system_prompt=rendered_system,
        user_prompt=rendered_user,
        model=payload.model,
        temperature=payload.temperature,
        max_output_tokens=payload.max_output_tokens,
    )

    return RunTestResponse(
        rendered_system=rendered_system,
        rendered_user=rendered_user,
        output_text=run_result["output_text"],
        usage=run_result["usage"],
        latency_ms=run_result["latency_ms"],
        provider_request_id=run_result["provider_request_id"],
    )

@router.post("/api/test/save_summary")
async def save_summary_handler(payload: SaveSummaryRequest, request: Request):
    summary_dir = request.app.state.settings.DATA_ROOT / "final_summary"
    summary_dir.mkdir(parents=True, exist_ok=True)
    file_path = summary_dir / f"final_summary_SEPM1763-{payload.ims_no}.json"
    
    clean_output = payload.output_text.strip()
    if clean_output.startswith("```"):
        lines = clean_output.splitlines()
        if lines[0].startswith("```"): lines = lines[1:]
        if lines and lines[-1].startswith("```"): lines = lines[:-1]
        clean_output = "\n".join(lines).strip()
    
    try:
        summary_data = json.loads(clean_output)
    except:
        summary_data = {"summary": clean_output, "run_type": payload.run_type}
        
    with file_path.open("w", encoding="utf-8") as f:
        json.dump(summary_data, f, ensure_ascii=False, indent=2)
    return {"status": "ok"}
