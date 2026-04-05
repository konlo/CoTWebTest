from app.data_repository import DataRepository


def test_extract_ims_no():
    assert DataRepository.extract_ims_no("SEPM1763-333.json") == "333"
    assert DataRepository.extract_ims_no("SEPM1763-376.dump.json") == "376"
    assert DataRepository.extract_ims_no("SEPM1763-abc.json") is None
    assert DataRepository.extract_ims_no("other-file.json") is None


def test_load_bundle_merges_all_sections(sample_settings):
    repository = DataRepository(sample_settings)

    bundle = repository.load_bundle("333")

    assert bundle.ims_no == "333"
    assert bundle.basic_info["service"] == "billing"
    assert bundle.ims_info["title"] == "IMS 333"
    assert bundle.host_info["hostname"] == "host-333"
    assert bundle.initial_into["summary"] == "initial capture"
    assert bundle.dump_info["files"] == ["dump-a.log"]
    assert bundle.missing_sections == []
    assert len(bundle.source_files) == 5


def test_missing_sections_are_reported(sample_settings):
    repository = DataRepository(sample_settings)

    bundle = repository.load_bundle("444")

    assert bundle.basic_info["service"] == "search"
    assert bundle.ims_info["title"] == "IMS 444"
    assert bundle.host_info is None
    assert bundle.initial_into is None
    assert bundle.dump_info is None
    assert bundle.missing_sections == ["host_info", "initial_into", "dump_info"]
