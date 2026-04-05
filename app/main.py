from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
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
    RenderRequest,
    RenderResponse,
    RunTestRequest,
    RunTestResponse,
    SavePromptRequest,
    SaveSummaryRequest,
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

    def load_bundle_or_404(ims_no: str) -> IMSBundle:
        try:
            return application.state.data_repository.load_bundle(ims_no)
        except KeyError as exc:
            raise HTTPException(
                status_code=404,
                detail=f"IMS {ims_no} was not found in the configured data directories.",
            ) from exc

    def get_asset_version() -> int:
        asset_paths = [
            app_settings.static_dir / "styles.css",
            app_settings.static_dir / "app.js",
        ]
        mtimes = [int(path.stat().st_mtime) for path in asset_paths if path.exists()]
        return max(mtimes) if mtimes else 0

    @application.get("/", response_class=HTMLResponse)
    async def index(request: Request):
        default_model = (
            app_settings.OLLAMA_MODEL
            if app_settings.resolved_llm_provider == "ollama"
            else app_settings.OPENAI_MODEL
        )
        return templates.TemplateResponse(
            request=request,
            name="index.html",
            context={
                "app_name": app_settings.APP_NAME,
                "default_model": default_model or "",
                "asset_version": get_asset_version(),
            },
        )

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

    @application.post("/api/prompts/render", response_model=RenderResponse)
    async def render_prompts(payload: RenderRequest):
        bundle = load_bundle_or_404(payload.ims_no)
        rendered_system, rendered_user, render_errors = (
            application.state.prompt_renderer.render_pair(
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

    @application.post("/api/prompts/save", response_model=PromptHistoryRecord)
    async def save_prompt(payload: SavePromptRequest):
        bundle = load_bundle_or_404(payload.ims_no)
        return application.state.prompt_store.save_record(
            payload,
            source_files=bundle.source_files,
        )

    @application.post("/api/test/run", response_model=RunTestResponse)
    async def run_test(payload: RunTestRequest):
        bundle = load_bundle_or_404(payload.ims_no)
        rendered_system, rendered_user, render_errors = (
            application.state.prompt_renderer.render_pair(
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
                error="Prompt rendering failed. Fix the template errors and retry.",
            )

        try:
            run_result = application.state.llm_service.run_test(
                system_prompt=rendered_system,
                user_prompt=rendered_user,
                model=payload.model,
                temperature=payload.temperature,
                max_output_tokens=payload.max_output_tokens,
            )
        except Exception as exc:  # pragma: no cover
            return RunTestResponse(
                rendered_system=rendered_system,
                rendered_user=rendered_user,
                error=str(exc),
            )

        return RunTestResponse(
            rendered_system=rendered_system,
            rendered_user=rendered_user,
            output_text=run_result["output_text"],
            usage=run_result["usage"],
            latency_ms=run_result["latency_ms"],
            provider_request_id=run_result["provider_request_id"],
        )

    @application.post("/api/test/save_summary")
    async def save_summary(payload: SaveSummaryRequest):
        import json
        
        summary_dir = app_settings.DATA_ROOT / "final_summary"
        summary_dir.mkdir(parents=True, exist_ok=True)
        
        file_path = summary_dir / f"SEPM1763-{payload.ims_no}_summary.json"
        
        # Clean output_text from markdown backticks if present
        clean_output = payload.output_text.strip()
        if clean_output.startswith("```"):
            lines = clean_output.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            clean_output = "\n".join(lines).strip()
            
        try:
            data = json.loads(clean_output)
        except Exception:
            # Fallback if parsing fails - shouldn't happen if LLM follows instructions
            data = {"output": payload.output_text}
            
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        return {"status": "success", "file": str(file_path)}

    @application.post("/api/test/audit/{ims_no}")
    async def audit_summary(ims_no: str):
        import json
        
        # 1. Load IMS Bundle for refer_info
        try:
            bundle = load_bundle_or_404(ims_no)
        except Exception as e:
            return {"error": f"IMS Bundle load failed: {str(e)}"}
            
        refer_info = bundle.refer_info
        if not refer_info:
            return {"error": "refer_info not found for this IMS"}
            
        ref_summary = refer_info.get("final_summary", "")
        if not ref_summary:
            return {"error": "final_summary field not found in refer_info"}
            
        # 2. Load saved final_summary
        summary_dir = app_settings.DATA_ROOT / "final_summary"
        file_path = summary_dir / f"SEPM1763-{ims_no}_summary.json"
        
        if not file_path.exists():
            return {"error": f"Generated summary file {file_path.name} not found"}
            
        with file_path.open("r", encoding="utf-8") as f:
            generated_data = json.load(f)
            
        gen_summary = generated_data.get("final_summary", "")
        if not gen_summary:
            return {"error": "final_summary field not found in generated file"}
            
        # 3. Call LLM to compare
        system_prompt = (
            "당신은 사고 분석 품질 감사 전문가입니다. "
            "사용자가 제공한 '기준 요약(Reference)'과 '생성된 요약(Generated)'을 비교하세요. "
            "유사성을 1점(전혀 다름)에서 10점(완벽히 일치) 사이의 점수로 매기세요. "
            "또한 핵심적인 차이점이나 개선점을 한두 문장으로 설명하세요. "
            "반드시 아래 JSON 형식으로만 응답하세요: {\"score\": 점수, \"explanation\": \"설명\"}"
        )
        user_prompt = f"Reference: {ref_summary}\n\nGenerated: {gen_summary}"
        
        try:
            result = application.state.llm_service.run_test(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=None, # Use default
                temperature=0.2,
                max_output_tokens=500
            )
            
            output = result["output_text"].strip()
            # Clean possible markdown
            if output.startswith("```"):
                lines = output.splitlines()
                if lines[0].startswith("```"): lines = lines[1:]
                if lines and lines[-1].startswith("```"): lines = lines[:-1]
                output = "\n".join(lines).strip()
            
            try:
                audit_data = json.loads(output)
            except json.JSONDecodeError:
                # Fallback for non-JSON output
                audit_data = {"score": 0, "explanation": output}
                
            return {
                "reference": ref_summary,
                "generated": gen_summary,
                "score": audit_data.get("score", 0),
                "explanation": audit_data.get("explanation", ""),
                "latency_ms": result["latency_ms"]
            }
        except Exception as e:
            return {"error": f"LLM comparison failed: {str(e)}", "reference": ref_summary, "generated": gen_summary}

    return application


app = create_app()
