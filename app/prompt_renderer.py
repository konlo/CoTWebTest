import json
from typing import Dict, Tuple

from jinja2 import Environment, StrictUndefined, TemplateError

from app.models import IMSBundle


class PromptRenderer:
    def __init__(self) -> None:
        self.environment = Environment(
            autoescape=False,
            keep_trailing_newline=True,
            trim_blocks=False,
            lstrip_blocks=False,
            undefined=StrictUndefined,
        )
        self.environment.filters["to_pretty_json"] = self.to_pretty_json

    @staticmethod
    def to_pretty_json(value) -> str:
        return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)

    @staticmethod
    def build_context(bundle: IMSBundle) -> Dict[str, object]:
        bundle_dict = bundle.model_dump()
        return {
            "ims_no": bundle.ims_no,
            "basic_info": bundle.basic_info,
            "ims_info": bundle.ims_info,
            "host_info": bundle.host_info,
            "initial_into": bundle.initial_into,
            "dump_info": bundle.dump_info,
            "bundle": bundle_dict,
        }

    def render_pair(
        self,
        system_template: str,
        user_template: str,
        bundle: IMSBundle,
    ) -> Tuple[str, str, Dict[str, str]]:
        context = self.build_context(bundle)
        rendered_system = ""
        rendered_user = ""
        render_errors: Dict[str, str] = {}

        try:
            rendered_system = self.environment.from_string(system_template).render(
                **context
            )
        except TemplateError as exc:
            render_errors["system_template"] = f"{exc.__class__.__name__}: {exc}"

        try:
            rendered_user = self.environment.from_string(user_template).render(**context)
        except TemplateError as exc:
            render_errors["user_template"] = f"{exc.__class__.__name__}: {exc}"

        return rendered_system, rendered_user, render_errors
