import pytest


for package_name in ("duckdb", "faiss", "numpy", "pandas", "sentence_transformers"):
    pytest.importorskip(package_name)

from connectors.vector_connector import VectorConnector


class FakeEmbeddingModel:
    def encode(self, texts, **_kwargs):
        import numpy as np

        return np.asarray(
            [[1.0, 0.0] if "alpha" in text else [0.0, 1.0] for text in texts],
            dtype="float32",
        )


@pytest.fixture
def connector(monkeypatch):
    instance = VectorConnector()
    monkeypatch.setattr(instance, "_get_model", lambda _model_name: FakeEmbeddingModel())
    return instance


def test_embedding_and_search_round_trip(tmp_path, connector):
    import pandas as pd

    context = {
        "source": pd.DataFrame(
            [
                {"id": "a", "text": "alpha document", "category": "first"},
                {"id": "b", "text": "beta document", "category": "second"},
            ]
        )
    }
    result = connector.execute(
        "embedding_vector_db",
        {
            "db_folder": str(tmp_path),
            "collection_name": "manuals",
            "input_data": "source",
            "id_column": "id",
            "text_column": "text",
        },
        context,
    )

    assert result.columns.tolist() == ["job_id", "target", "path", "executed_at"]
    assert result.loc[0, "target"] == "manuals"
    assert result.loc[0, "path"] == str(tmp_path)
    search_result = connector.execute(
        "search_vector_db",
        {
            "db_folder": str(tmp_path),
            "collection_name": "manuals",
            "query_text": "alpha query",
            "top_k": 1,
        },
        {},
    )

    assert search_result.loc[0, "id"] == "a"
    assert search_result.loc[0, "metadata"] == '{"category":"first"}'


def test_search_includes_stored_vector_when_requested(tmp_path, connector):
    import json
    import pandas as pd

    connector.execute(
        "embedding_vector_db",
        {
            "db_folder": str(tmp_path),
            "collection_name": "manuals",
            "input_data": "source",
            "id_column": "id",
            "text_column": "text",
        },
        {"source": pd.DataFrame([{"id": "a", "text": "alpha document"}])},
    )
    search_result = connector.execute(
        "search_vector_db",
        {
            "db_folder": str(tmp_path),
            "collection_name": "manuals",
            "query_text": "alpha query",
            "top_k": 1,
            "include_vector": "true",
        },
        {},
    )

    assert json.loads(search_result.loc[0, "vector"]) == [1.0, 0.0]


def test_embedding_replaces_same_id(tmp_path, connector):
    import pandas as pd

    params = {
        "db_folder": str(tmp_path),
        "collection_name": "manuals",
        "input_data": "source",
        "id_column": "id",
        "text_column": "text",
    }
    connector.execute(
        "embedding_vector_db",
        params,
        {"source": pd.DataFrame([{"id": "a", "text": "beta document"}])},
    )
    connector.execute(
        "embedding_vector_db",
        params,
        {"source": pd.DataFrame([{"id": "a", "text": "alpha document"}])},
    )

    search_result = connector.execute(
        "search_vector_db",
        {
            "db_folder": str(tmp_path),
            "collection_name": "manuals",
            "query_text": "alpha query",
            "top_k": 5,
        },
        {},
    )

    assert search_result["id"].tolist() == ["a"]
