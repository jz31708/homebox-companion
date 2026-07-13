from homebox_companion.medicine.reference_download import metadata_for_downloads


def test_download_metadata_records_checksums():
    metadata = metadata_for_downloads({"specialities": (b"x", "abc")})
    assert metadata["specialities_sha256"] == "abc"
    assert "downloaded_at" in metadata
