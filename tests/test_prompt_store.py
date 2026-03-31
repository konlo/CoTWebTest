from app.models import SavePromptRequest


def test_prompt_store_appends_and_reads_history(prompt_store):
    record = prompt_store.save_record(
        SavePromptRequest(
            ims_no="333",
            title="First prompt",
            system_template="system",
            user_template="user",
            model="gpt-test",
            notes="baseline",
        ),
        source_files={"basic_info": "/tmp/basic.json"},
    )

    history = prompt_store.list_history()
    loaded = prompt_store.get_record(record.id)
    latest = prompt_store.get_latest_record()

    assert len(history) == 1
    assert history[0].id == record.id
    assert loaded.title == "First prompt"
    assert latest is not None
    assert latest.id == record.id
    assert prompt_store.settings.prompt_history_path.exists()
