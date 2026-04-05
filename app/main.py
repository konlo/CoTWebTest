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
    AuditSaveRequest,
    AuditHistoryRecord,
)
from app.prompt_renderer import PromptRenderer
from app.prompt_store import PromptStore
from app.similarity_prompt import SIMILARITY_PROMPT


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
        if app_settings.resolved_llm_provider == "ollama":
            default_model = app_settings.OLLAMA_MODEL
        elif app_settings.resolved_llm_provider == "gpt-oss":
            default_model = app_settings.GPT_OSS_MODEL
        else:
            default_model = app_settings.OPENAI_MODEL
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
    async def audit_summary(ims_no: str, payload: AuditSaveRequest):
        import json
        import datetime
        import uuid
        
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
            return {"error": f"final_summary field not found in generated file {file_path.name}"}
            
        # 3. Call LLM to compare
        user_prompt = SIMILARITY_PROMPT.replace("{TEXT_A}", ref_summary).replace("{TEXT_B}", gen_summary)
        
        try:
            result = application.state.llm_service.run_test(
                system_prompt="당신은 텍스트 유사도 평가 전문가입니다.",
                user_prompt=user_prompt,
                model=None, # Use default
                temperature=0,
                max_output_tokens=1000
            )
            
            output = result["output_text"].strip()
            
            # Robust JSON extraction
            import re
            json_match = re.search(r'\{.*\}', output, re.DOTALL)
            audit_data = {}
            if json_match:
                try:
                    audit_data = json.loads(json_match.group())
                except json.JSONDecodeError:
                    # Try to extract final_score if JSON is broken
                    score_match = re.search(r'"final_score":\s*([\d\.]+)', output)
                    score = float(score_match.group(1)) if score_match else 0
                    audit_data = {"final_score": score, "explanation": f"JSON 파싱 실패: {output}"}
            else:
                score_match = re.search(r'"final_score":\s*([\d\.]+)', output)
                if score_match:
                    audit_data = {"final_score": float(score_match.group(1)), "explanation": output}
                else:
                    audit_data = {"final_score": 0, "explanation": output or "LLM 응답이 비어있습니다."}
                
            # 4. Save Audit result to History
            history_dir = app_settings.DATA_ROOT / "audit_history"
            history_dir.mkdir(parents=True, exist_ok=True)
            
            audit_id = f"audit_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
            audit_record = AuditHistoryRecord(
                id=audit_id,
                saved_at=datetime.datetime.now().isoformat(),
                ims_no=ims_no,
                system_template=payload.system_template,
                user_template=payload.user_template,
                refer_info=ref_summary,
                generated_summary=gen_summary,
                audit_score=audit_data.get("final_score", 0),
                audit_explanation=audit_data.get("explanation", "") or "설명 없음",
                semantic=audit_data.get("semantic", 0),
                keyword=audit_data.get("keyword", 0),
                structure=audit_data.get("structure", 0),
                intent=audit_data.get("intent", 0),
                latency_ms=result["latency_ms"]
            )
            
            record_path = history_dir / f"{audit_id}.json"
            with record_path.open("w", encoding="utf-8") as f:
                json.dump(audit_record.dict(), f, ensure_ascii=False, indent=2)

            return audit_record.dict()
            
        except Exception as e:
            return {"error": f"LLM comparison failed: {str(e)}", "reference": ref_summary, "generated": gen_summary}

    @application.get("/api/audit/history")
    async def list_audit_history():
        import json
        history_dir = app_settings.DATA_ROOT / "audit_history"
        if not history_dir.exists():
            return []
            
        records = []
        for file_path in sorted(history_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                with file_path.open("r", encoding="utf-8") as f:
                    data = json.load(f)
                    # For summary list, minimize data
                    records.append({
                        "id": data["id"],
                        "saved_at": data["saved_at"],
                        "ims_no": data["ims_no"],
                        "score": data["audit_score"]
                    })
            except Exception:
                continue
        return records

    @application.get("/api/audit/history/{record_id}")
    async def get_audit_record(record_id: str):
        import json
        history_dir = app_settings.DATA_ROOT / "audit_history"
        file_path = history_dir / f"{record_id}.json"
        
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Audit record not found")
            
        with file_path.open("r", encoding="utf-8") as f:
            return json.load(f)

    @application.post("/api/test/batch_audit")
    async def batch_audit_summary(payload: AuditSaveRequest):
        import json
        import datetime
        import uuid
        
        ims_list = application.state.data_repository.list_ims()
        
        batch_id = f"batch_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        batch_results = []
        total_score = 0
        executed_count = 0
        
        summary_dir = app_settings.DATA_ROOT / "final_summary"
        
        for item in ims_list:
            ims_no = item.ims_no
            
            # Simplified audit per IMS (shared logic from audit_summary)
            try:
                bundle = load_bundle_or_404(ims_no)
                ref_summary = bundle.refer_info.get("final_summary", "") if bundle.refer_info else ""
                
                file_path = summary_dir / f"SEPM1763-{ims_no}_summary.json"
                if not file_path.exists() or not ref_summary:
                    continue
                    
                with file_path.open("r", encoding="utf-8") as f:
                    generated_data = json.load(f)
                gen_summary = generated_data.get("final_summary", "")
                
                user_prompt = SIMILARITY_PROMPT.replace("{TEXT_A}", ref_summary).replace("{TEXT_B}", gen_summary)
                
                llm_result = application.state.llm_service.run_test(
                    system_prompt="당신은 텍스트 유사도 평가 전문가입니다.",
                    user_prompt=user_prompt,
                    model=None, temperature=0, max_output_tokens=1000
                )
                
                import re
                output = llm_result["output_text"].strip()
                json_match = re.search(r'\{.*\}', output, re.DOTALL)
                
                audit_data = {}
                if json_match:
                    try:
                        audit_data = json.loads(json_match.group())
                    except:
                        score_match = re.search(r'"final_score":\s*([\d\.]+)', output)
                        score = float(score_match.group(1)) if score_match else 0
                        audit_data = {"final_score": score, "explanation": output}
                else:
                    score_match = re.search(r'"final_score":\s*([\d\.]+)', output)
                    score = float(score_match.group(1)) if score_match else 0
                    audit_data = {"final_score": score, "explanation": output or "No response"}
                
                score = audit_data.get("final_score", 0)
                batch_results.append({
                    "ims_no": ims_no,
                    "score": score,
                    "explanation": audit_data.get("explanation", ""),
                    "refer_info": ref_summary,
                    "generated_summary": gen_summary
                })
                total_score += score
                executed_count += 1
                
            except Exception:
                continue

        avg_score = round(total_score / executed_count, 2) if executed_count > 0 else 0
        
        # Save Consolidated Batch Result
        history_dir = app_settings.DATA_ROOT / "batch_audit_history"
        history_dir.mkdir(parents=True, exist_ok=True)
        
        record = {
            "id": batch_id,
            "saved_at": datetime.datetime.now().isoformat(),
            "avg_score": avg_score,
            "results": batch_results,
            "system_template": payload.system_template,
            "user_template": payload.user_template
        }
        
        record_path = history_dir / f"{batch_id}.json"
        with record_path.open("w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
            
        return record

    @application.post("/api/audit/batch/save")
    async def save_batch_audit(data: dict):
        import json
        import datetime
        import uuid
        
        batch_id = f"batch_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        data["id"] = batch_id
        data["saved_at"] = datetime.datetime.now().isoformat()
        
        history_dir = app_settings.DATA_ROOT / "batch_audit_history"
        history_dir.mkdir(parents=True, exist_ok=True)
        
        record_path = history_dir / f"{batch_id}.json"
        with record_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        return data

    @application.get("/api/audit/batch/list")
    async def list_batch_history():
        import json
        history_dir = app_settings.DATA_ROOT / "batch_audit_history"
        if not history_dir.exists():
            return []
            
        records = []
        for file_path in sorted(history_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                with file_path.open("r", encoding="utf-8") as f:
                    data = json.load(f)
                    records.append({
                        "id": data["id"],
                        "saved_at": data["saved_at"],
                        "avg_score": data["avg_score"],
                        "count": len(data["results"])
                    })
            except Exception:
                continue
        return records

    @application.get("/api/audit/batch/{record_id}")
    async def get_batch_record(record_id: str):
        import json
        history_dir = app_settings.DATA_ROOT / "batch_audit_history"
        file_path = history_dir / f"{record_id}.json"
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Batch audit record not found")
        with file_path.open("r", encoding="utf-8") as f:
            return json.load(f)

    return application


app = create_app()
