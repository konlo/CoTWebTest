from typing import List
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse
from app.models import AuditSaveRequest, AuditHistoryRecord
from app.similarity_prompt import SIMILARITY_PROMPT
import json
import datetime
import uuid
import re

router = APIRouter()

def get_asset_version(app_settings):
    asset_paths = [
        app_settings.static_dir / "styles.css",
        app_settings.static_dir / "app.js",
    ]
    mtimes = [int(path.stat().st_mtime) for path in asset_paths if path.exists()]
    return max(mtimes) if mtimes else 0

@router.get("/compare", response_class=HTMLResponse)
async def compare_page(request: Request):
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
        name="compare.html",
        context={
            "app_name": f"{app_settings.APP_NAME} - Comparator",
            "default_model": default_model or "",
            "asset_version": get_asset_version(app_settings),
        },
    )

@router.get("/api/audit/similarity_prompt")
async def get_similarity_prompt():
    return {"prompt": SIMILARITY_PROMPT}

@router.post("/api/test/audit/{ims_no}")
async def audit_summary(ims_no: str, payload: AuditSaveRequest, request: Request):
    app_settings = request.app.state.settings
    data_repo = request.app.state.data_repository
    llm_service = request.app.state.llm_service
    
    bundle = data_repo.load_bundle(ims_no)
    refer_info = bundle.refer_info
    if not refer_info:
        return {"error": "refer_info not found for this IMS"}
        
    ref_summary = ""
    if isinstance(refer_info, dict):
        ref_summary = refer_info.get("final_summary", "")
    else:
        ref_summary = str(refer_info)
        
    if not ref_summary:
        return {"error": "final_summary field not found in refer_info"}
        
    summary_dir = app_settings.DATA_ROOT / "final_summary"
    file_path = summary_dir / f"SEPM1763-{ims_no}_summary.json"
    
    if not file_path.exists():
        return {"error": f"Generated summary file {file_path.name} not found"}
        
    with file_path.open("r", encoding="utf-8") as f:
        generated_data = json.load(f)
        
    gen_summary = generated_data.get("final_summary", "")
    if not gen_summary:
        return {"error": "final_summary field not found in generated record"}
        
    prompt_template = payload.similarity_prompt or SIMILARITY_PROMPT
    user_prompt = prompt_template.replace("{TEXT_A}", ref_summary).replace("{TEXT_B}", gen_summary)
    
    result = llm_service.run_test(
        system_prompt="당신은 텍스트 유사도 평가 전문가입니다.",
        user_prompt=user_prompt,
        model=None,
        temperature=0,
        max_output_tokens=1000
    )
    
    output = result["output_text"].strip()
    
    # Try to extract scores with Regex as a fallback or primary method
    def extract_val(key, text):
        match = re.search(fr'"{key}"\s*:\s*([\d.]+)', text)
        if match:
            try: return float(match.group(1))
            except: return 0
        return 0

    json_match = re.search(r'\{.*\}', output, re.DOTALL)
    audit_data = {}
    if json_match:
        content = json_match.group()
        try:
            audit_data = json.loads(content)
        except json.JSONDecodeError:
            # If JSON is truncated, try helping it by adding closing brackets
            try:
                # Basic attempt to fix truncated JSON by adding closing quotes and brackets
                # This is a bit naive but can help with common truncation patterns
                if content.count('{') > content.count('}'):
                    # Check if it ends in the middle of a string
                    if content.count('"') % 2 != 0: content += '"'
                    content += '}' * (content.count('{') - content.count('}'))
                audit_data = json.loads(content)
            except:
                # Still failed? Fallback to Regex for individual fields
                audit_data = {
                    "semantic": int(extract_val("semantic", output)),
                    "keyword": int(extract_val("keyword", output)),
                    "structure": int(extract_val("structure", output)),
                    "intent": int(extract_val("intent", output)),
                    "final_score": extract_val("final_score", output),
                    "explanation": output # Fallback explanation to full output
                }
    else:
        # No JSON structure found? Use Regex
        audit_data = {
            "semantic": int(extract_val("semantic", output)),
            "keyword": int(extract_val("keyword", output)),
            "structure": int(extract_val("structure", output)),
            "intent": int(extract_val("intent", output)),
            "final_score": extract_val("final_score", output),
            "explanation": output or "No response from LLM"
        }
        
    record_id = f"audit_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    record = AuditHistoryRecord(
        id=record_id,
        saved_at=datetime.datetime.now().isoformat(),
        ims_no=ims_no,
        system_template=payload.system_template,
        user_template=payload.user_template,
        refer_info=ref_summary,
        generated_summary=gen_summary,
        audit_score=audit_data.get("final_score", 0),
        audit_explanation=audit_data.get("explanation", ""),
        semantic=audit_data.get("semantic", 0),
        keyword=audit_data.get("keyword", 0),
        structure=audit_data.get("structure", 0),
        intent=audit_data.get("intent", 0),
        latency_ms=result["latency_ms"]
    )
    
    audit_history_dir = app_settings.DATA_ROOT / "audit_history"
    audit_history_dir.mkdir(parents=True, exist_ok=True)
    with open(audit_history_dir / f"{record_id}.json", "w", encoding="utf-8") as f:
        json.dump(record.model_dump(), f, ensure_ascii=False, indent=2)
        
    return record

@router.get("/api/audit/history")
async def list_audit_history(request: Request):
    app_settings = request.app.state.settings
    audit_history_dir = app_settings.DATA_ROOT / "audit_history"
    if not audit_history_dir.exists(): return []
    
    records = []
    for path in sorted(audit_history_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        with path.open("r", encoding="utf-8") as f:
            records.append(json.load(f))
    return records

@router.get("/api/audit/history/{record_id}")
async def get_audit_record(record_id: str, request: Request):
    app_settings = request.app.state.settings
    audit_history_dir = app_settings.DATA_ROOT / "audit_history"
    path = audit_history_dir / f"{record_id}.json"
    if not path.exists(): raise HTTPException(404)
    with path.open("r", encoding="utf-8") as f: return json.load(f)

@router.get("/api/audit/batch/list")
async def list_batch_audit(request: Request):
    app_settings = request.app.state.settings
    history_dir = app_settings.DATA_ROOT / "batch_audit_history"
    if not history_dir.exists(): return []
    
    items = []
    for path in sorted(history_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
            items.append({
                "id": data.get("id"),
                "saved_at": data.get("saved_at"),
                "avg_score": data.get("avg_score"),
                "count": len(data.get("results", []))
            })
    return items

@router.get("/api/audit/batch/{record_id}")
async def get_batch_record(record_id: str, request: Request):
    app_settings = request.app.state.settings
    history_dir = app_settings.DATA_ROOT / "batch_audit_history"
    path = history_dir / f"{record_id}.json"
    if not path.exists(): raise HTTPException(404)
    with path.open("r", encoding="utf-8") as f: return json.load(f)
