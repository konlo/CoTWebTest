def test_list_ims(client):
    response = client.get("/api/ims")

    assert response.status_code == 200
    payload = response.json()
    assert [item["ims_no"] for item in payload] == ["333", "444"]


def test_get_ims_bundle(client):
    response = client.get("/api/ims/333")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ims_no"] == "333"
    assert payload["host_info"]["hostname"] == "host-333"


def test_render_endpoint(client):
    response = client.post(
        "/api/prompts/render",
        json={
            "ims_no": "333",
            "system_template": "S {{ ims_no }}",
            "user_template": "U {{ basic_info.service }}",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["rendered_system"] == "S 333"
    assert payload["rendered_user"] == "U billing"
    assert payload["render_errors"] == {}


def test_save_and_reload_prompt_history(client):
    save_response = client.post(
        "/api/prompts/save",
        json={
            "ims_no": "333",
            "title": "Saved prompt",
            "system_template": "sys",
            "user_template": "usr",
            "model": "gpt-test",
            "notes": "saved from test",
        },
    )

    assert save_response.status_code == 200
    record = save_response.json()

    history_response = client.get("/api/prompts/history")
    detail_response = client.get(f"/api/prompts/history/{record['id']}")

    assert history_response.status_code == 200
    assert history_response.json()[0]["id"] == record["id"]
    assert detail_response.status_code == 200
    assert detail_response.json()["title"] == "Saved prompt"


def test_run_endpoint_uses_mocked_openai(client, fake_client_factory):
    response = client.post(
        "/api/test/run",
        json={
            "ims_no": "333",
            "system_template": "System {{ ims_no }}",
            "user_template": "User {{ ims_info.title }}",
            "model": "gpt-test",
            "temperature": 0.3,
            "max_output_tokens": 400,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["rendered_system"] == "System 333"
    assert payload["rendered_user"] == "User IMS 333"
    assert payload["output_text"] == "Mocked model output"
    assert payload["usage"]["total_tokens"] == 22
    assert payload["provider_request_id"] == "resp_test_123"
    assert fake_client_factory.instances[0].responses.calls[0]["model"] == "gpt-test"


def test_run_endpoint_uses_mocked_google_compatibility(sample_settings, fake_client_factory):
    from app.main import create_app
    from fastapi.testclient import TestClient

    sample_settings.LLM_PROVIDER = "google"
    sample_settings.GOOGLE_API_KEY = "google-test-key"
    sample_settings.OPENAI_MODEL = "gemini-2.5-flash"

    app = create_app(settings=sample_settings, llm_service=None)
    app.state.llm_service.client_factory = fake_client_factory
    app.state.llm_service._clients = {}
    client = TestClient(app)

    response = client.post(
        "/api/test/run",
        json={
            "ims_no": "333",
            "system_template": "System {{ ims_no }}",
            "user_template": "User {{ ims_info.title }}",
            "model": "gemini-2.5-flash",
            "temperature": 0.3,
            "max_output_tokens": 400,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["output_text"] == "Mocked Gemini output"
    assert payload["usage"]["total_tokens"] == 16
    assert payload["provider_request_id"] == "chatcmpl_test_456"
    assert fake_client_factory.instances[-1].base_url == sample_settings.GOOGLE_OPENAI_BASE_URL
