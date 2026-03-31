from app.data_repository import DataRepository
from app.prompt_renderer import PromptRenderer


def test_render_pair_success(sample_settings):
    repository = DataRepository(sample_settings)
    bundle = repository.load_bundle("333")
    renderer = PromptRenderer()

    rendered_system, rendered_user, errors = renderer.render_pair(
        "IMS {{ ims_no }}",
        "Owner {{ ims_info.title }} / {{ basic_info.service }}",
        bundle,
    )

    assert rendered_system == "IMS 333"
    assert rendered_user == "Owner IMS 333 / billing"
    assert errors == {}


def test_render_pair_reports_undefined_variables(sample_settings):
    repository = DataRepository(sample_settings)
    bundle = repository.load_bundle("333")
    renderer = PromptRenderer()

    rendered_system, rendered_user, errors = renderer.render_pair(
        "IMS {{ ims_no }}",
        "Unknown {{ not_defined }}",
        bundle,
    )

    assert rendered_system == "IMS 333"
    assert rendered_user == ""
    assert "user_template" in errors
