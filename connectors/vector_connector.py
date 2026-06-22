from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from connectors.base_connector import BaseConnector

try:  # pragma: no cover - availability is checked by execute
    import duckdb
except ImportError:  # pragma: no cover
    duckdb = None

try:  # pragma: no cover - availability is checked by execute
    import faiss
except ImportError:  # pragma: no cover
    faiss = None

try:  # pragma: no cover - availability is checked by execute
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

try:  # pragma: no cover - availability is checked by execute
    from sentence_transformers import SentenceTransformer
except ImportError:  # pragma: no cover
    SentenceTransformer = None


class VectorConnector(BaseConnector):
    DEFAULT_MODEL_NAME = "cl-nagoya/ruri-v3-30m"
    _model_cache: dict[str, Any] = {}

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> pd.DataFrame:
        self._ensure_dependencies()

        if action == "embedding_vector_db":
            return self.embedding_vector_db(
                db_folder=params.get("db_folder"),
                collection_name=params.get("collection_name"),
                input_data=params.get("input_data"),
                id_column=params.get("id_column"),
                text_column=params.get("text_column"),
                model_name=params.get("model_name"),
                context=context,
            )

        if action == "search_vector_db":
            return self.search_vector_db(
                db_folder=params.get("db_folder"),
                collection_name=params.get("collection_name"),
                query_text=params.get("query_text"),
                top_k=params.get("top_k"),
                include_vector=params.get("include_vector"),
                model_name=params.get("model_name"),
            )

        raise ValueError(f"Unknown action: {action}")

    @classmethod
    def _ensure_dependencies(cls) -> None:
        missing = []
        if duckdb is None:
            missing.append("duckdb")
        if faiss is None:
            missing.append("faiss-cpu")
        if np is None:
            missing.append("numpy")
        if SentenceTransformer is None:
            missing.append("sentence-transformers")
        if missing:
            packages = " ".join(missing)
            raise ImportError(
                "VectorConnector に必要なライブラリがインストールされていません: "
                f"{', '.join(missing)}。'pip install {packages}' を実行してください。"
            )

    def embedding_vector_db(
        self,
        db_folder: Any,
        collection_name: Any,
        input_data: Any,
        id_column: Any,
        text_column: Any,
        model_name: Any,
        context: dict[str, Any],
    ) -> pd.DataFrame:
        storage = self._resolve_storage(db_folder, collection_name, create_folder=True)
        source_name = self._require_text(input_data, "input_data")
        normalized_id_column = self._require_text(id_column, "id_column")
        normalized_text_column = self._require_text(text_column, "text_column")
        normalized_model_name = self._resolve_model_name(model_name)

        source = context.get(source_name)
        if source is None:
            raise ValueError(f"変数 '{source_name}' にデータがありません。")
        dataframe = self.to_dataframe(source)
        records = self._build_records(dataframe, normalized_id_column, normalized_text_column)
        model = self._get_model(normalized_model_name)
        embeddings = self._encode(model, [record["text"] for record in records])
        dimension = int(embeddings.shape[1])

        connection = duckdb.connect(str(storage["metadata_path"]))
        try:
            self._initialize_metadata_schema(connection)
            settings = self._read_settings(connection)
            self._validate_settings(settings, normalized_model_name, dimension)
            index = self._load_or_create_index(storage["index_path"], connection, dimension)
            record_ids_to_faiss_ids = self._read_faiss_ids(connection)
            existing_faiss_ids = [
                record_ids_to_faiss_ids[record["id"]]
                for record in records
                if record["id"] in record_ids_to_faiss_ids
            ]
            next_faiss_id = max(record_ids_to_faiss_ids.values(), default=-1) + 1
            for record in records:
                record["faiss_id"] = record_ids_to_faiss_ids.get(record["id"])
                if record["faiss_id"] is None:
                    record["faiss_id"] = next_faiss_id
                    next_faiss_id += 1

            if existing_faiss_ids:
                index.remove_ids(np.asarray(existing_faiss_ids, dtype="int64"))
            index.add_with_ids(
                np.asarray(embeddings, dtype="float32"),
                np.asarray([record["faiss_id"] for record in records], dtype="int64"),
            )
            self._write_metadata(connection, records, normalized_model_name, dimension)
            faiss.write_index(index, str(storage["index_path"]))
        finally:
            connection.close()

        return self.attach_dataframe_schema(
            self.to_dataframe(
                {
                    "collection_name": storage["collection_name"],
                    "registered_records": len(records),
                    "db_folder": str(storage["folder"]),
                    "index_path": str(storage["index_path"]),
                    "metadata_path": str(storage["metadata_path"]),
                    "model_name": normalized_model_name,
                    "dimension": dimension,
                }
            )
        )

    def search_vector_db(
        self,
        db_folder: Any,
        collection_name: Any,
        query_text: Any,
        top_k: Any,
        include_vector: Any,
        model_name: Any,
    ) -> pd.DataFrame:
        storage = self._resolve_storage(db_folder, collection_name, create_folder=False)
        normalized_query_text = self._require_text(query_text, "query_text")
        normalized_top_k = self._parse_top_k(top_k)
        normalized_include_vector = self._parse_bool(include_vector)
        normalized_model_name = self._resolve_model_name(model_name)
        if not storage["index_path"].is_file() or not storage["metadata_path"].is_file():
            raise FileNotFoundError(
                "コレクションが見つかりません。先に embedding_vector_db を実行してください: "
                f"{storage['collection_name']}"
            )

        connection = duckdb.connect(str(storage["metadata_path"]), read_only=True)
        try:
            settings = self._read_settings(connection)
            if not settings:
                raise ValueError("コレクション設定がありません。コレクションを再構築してください。")
            configured_dimension = int(settings["dimension"])
            self._validate_settings(settings, normalized_model_name, configured_dimension)
            index = faiss.read_index(str(storage["index_path"]))
            if int(index.d) != configured_dimension:
                raise ValueError("FAISS index とコレクション設定のベクトル次元数が一致しません。")

            model = self._get_model(normalized_model_name)
            query_embedding = self._encode(model, [normalized_query_text])
            if int(query_embedding.shape[1]) != configured_dimension:
                raise ValueError(
                    "検索ベクトルの次元数がコレクション設定と一致しません。"
                    "同じ埋め込みモデルを指定してください。"
                )
            if index.ntotal == 0:
                return self._empty_search_result(normalized_include_vector)

            scores, faiss_ids = index.search(query_embedding, min(normalized_top_k, int(index.ntotal)))
            records_by_faiss_id = self._read_records(connection, faiss_ids[0].tolist())
        finally:
            connection.close()

        rows = []
        for score, faiss_id in zip(scores[0].tolist(), faiss_ids[0].tolist()):
            record = records_by_faiss_id.get(int(faiss_id))
            if record is None:
                continue
            rows.append(
                {
                    "id": record["id"],
                    "text": record["text"],
                    "score": float(score),
                    "metadata": record["metadata_json"],
                    "collection_name": storage["collection_name"],
                }
            )
            if normalized_include_vector:
                rows[-1]["vector"] = json.dumps(
                    index.reconstruct(int(faiss_id)).tolist(),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
        return self.attach_dataframe_schema(
            pd.DataFrame(rows, columns=self._search_result_columns(normalized_include_vector))
        )

    @classmethod
    def _resolve_storage(cls, db_folder: Any, collection_name: Any, create_folder: bool) -> dict[str, Any]:
        folder_text = cls._require_text(db_folder, "db_folder")
        normalized_collection_name = cls._validate_collection_name(collection_name)
        folder = Path(BaseConnector.normalize_file_path(folder_text)).expanduser().resolve()
        if create_folder:
            folder.mkdir(parents=True, exist_ok=True)
        elif not folder.is_dir():
            raise FileNotFoundError(f"db_folder が見つかりません: {folder}")

        return {
            "folder": folder,
            "collection_name": normalized_collection_name,
            "index_path": folder / f"{normalized_collection_name}.faiss",
            "metadata_path": folder / f"{normalized_collection_name}.duckdb",
        }

    @staticmethod
    def _require_text(value: Any, field_name: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError(f"{field_name} は必須です。")
        return text

    @staticmethod
    def _validate_collection_name(value: Any) -> str:
        name = VectorConnector._require_text(value, "collection_name")
        if not re.fullmatch(r"[\w-]+", name, flags=re.UNICODE):
            raise ValueError("collection_name は英数字・日本語・アンダースコア・ハイフンのみ使用できます。")
        return name

    @classmethod
    def _resolve_model_name(cls, value: Any) -> str:
        text = str(value or "").strip()
        return text or cls.DEFAULT_MODEL_NAME

    @staticmethod
    def _parse_top_k(value: Any) -> int:
        try:
            top_k = int(value)
        except (TypeError, ValueError) as error:
            raise ValueError("top_k は正の整数で指定してください。") from error
        if top_k < 1:
            raise ValueError("top_k は1以上で指定してください。")
        return top_k

    @staticmethod
    def _parse_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        return str(value or "").strip().lower() in {"1", "true", "yes", "on"}

    @classmethod
    def _get_model(cls, model_name: str):
        model = cls._model_cache.get(model_name)
        if model is None:
            model = SentenceTransformer(model_name, device="cpu")
            cls._model_cache[model_name] = model
        return model

    @staticmethod
    def _encode(model, texts: list[str]):
        embeddings = model.encode(
            texts,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        embeddings = np.asarray(embeddings, dtype="float32")
        if embeddings.ndim != 2 or embeddings.shape[0] != len(texts):
            raise ValueError("埋め込みモデルから不正なベクトルが返されました。")
        return embeddings

    @classmethod
    def _build_records(cls, dataframe: pd.DataFrame, id_column: str, text_column: str) -> list[dict[str, Any]]:
        if dataframe.empty:
            raise ValueError("input_data に有効なデータがありません。")
        missing_columns = [column for column in (id_column, text_column) if column not in dataframe.columns]
        if missing_columns:
            raise ValueError(f"input_data に指定列がありません: {', '.join(missing_columns)}")

        records = []
        record_ids = set()
        for row_number, (_, row) in enumerate(dataframe.iterrows(), start=1):
            record_id = cls._to_required_value(row[id_column], id_column, row_number)
            text = cls._to_required_value(row[text_column], text_column, row_number)
            if record_id in record_ids:
                raise ValueError(f"id_column に重複した値があります: {record_id}")
            record_ids.add(record_id)
            metadata = {
                str(column): cls._to_json_compatible(value)
                for column, value in row.items()
                if column not in {id_column, text_column}
            }
            records.append(
                {
                    "id": record_id,
                    "text": text,
                    "metadata_json": json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
                }
            )
        return records

    @staticmethod
    def _to_required_value(value: Any, column_name: str, row_number: int) -> str:
        is_missing = value is None or value is pd.NA
        if isinstance(value, float) and pd.isna(value):
            is_missing = True
        if is_missing or not str(value).strip():
            raise ValueError(f"{column_name} の {row_number} 行目が空です。")
        return str(value).strip()

    @staticmethod
    def _to_json_compatible(value: Any) -> Any:
        if value is None or value is pd.NA:
            return None
        if isinstance(value, float) and pd.isna(value):
            return None
        if hasattr(value, "item"):
            try:
                value = value.item()
            except ValueError:
                pass
        if isinstance(value, (datetime, pd.Timestamp)):
            return value.isoformat()
        if isinstance(value, (str, int, float, bool)):
            return value
        return str(value)

    @staticmethod
    def _initialize_metadata_schema(connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS vector_records (
                record_id VARCHAR PRIMARY KEY,
                faiss_id BIGINT UNIQUE NOT NULL,
                text VARCHAR NOT NULL,
                metadata_json VARCHAR NOT NULL,
                updated_at TIMESTAMP NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS collection_settings (
                setting_key VARCHAR PRIMARY KEY,
                setting_value VARCHAR NOT NULL
            )
            """
        )

    @staticmethod
    def _read_settings(connection) -> dict[str, str]:
        return {
            str(key): str(value)
            for key, value in connection.execute(
                "SELECT setting_key, setting_value FROM collection_settings"
            ).fetchall()
        }

    @staticmethod
    def _validate_settings(settings: dict[str, str], model_name: str, dimension: int) -> None:
        if not settings:
            return
        if settings.get("model_name") != model_name:
            raise ValueError(
                "指定した model_name がコレクション作成時のモデルと異なります: "
                f"{settings.get('model_name')}"
            )
        if int(settings.get("dimension", "-1")) != dimension:
            raise ValueError("埋め込みベクトルの次元数がコレクション設定と一致しません。")

    @staticmethod
    def _load_or_create_index(index_path: Path, connection, dimension: int):
        record_count = int(connection.execute("SELECT COUNT(*) FROM vector_records").fetchone()[0])
        if index_path.is_file():
            index = faiss.read_index(str(index_path))
            if int(index.d) != dimension:
                raise ValueError("既存 FAISS index のベクトル次元数が一致しません。")
            return index
        if record_count:
            raise ValueError("FAISS index が見つかりません。コレクションを再構築してください。")
        return faiss.IndexIDMap2(faiss.IndexFlatIP(dimension))

    @staticmethod
    def _read_faiss_ids(connection) -> dict[str, int]:
        rows = connection.execute("SELECT record_id, faiss_id FROM vector_records").fetchall()
        return {str(record_id): int(faiss_id) for record_id, faiss_id in rows}

    @staticmethod
    def _write_metadata(connection, records: list[dict[str, Any]], model_name: str, dimension: int) -> None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        connection.execute("BEGIN TRANSACTION")
        try:
            for record in records:
                connection.execute("DELETE FROM vector_records WHERE record_id = ?", [record["id"]])
                connection.execute(
                    """
                    INSERT INTO vector_records (record_id, faiss_id, text, metadata_json, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    [record["id"], record["faiss_id"], record["text"], record["metadata_json"], now],
                )
            connection.execute("DELETE FROM collection_settings")
            connection.executemany(
                "INSERT INTO collection_settings (setting_key, setting_value) VALUES (?, ?)",
                [("model_name", model_name), ("dimension", str(dimension)), ("metric", "cosine")],
            )
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise

    @staticmethod
    def _read_records(connection, faiss_ids: list[int]) -> dict[int, dict[str, Any]]:
        requested_ids = [int(faiss_id) for faiss_id in faiss_ids if int(faiss_id) >= 0]
        if not requested_ids:
            return {}
        placeholders = ", ".join("?" for _ in requested_ids)
        rows = connection.execute(
            f"SELECT faiss_id, record_id, text, metadata_json FROM vector_records WHERE faiss_id IN ({placeholders})",
            requested_ids,
        ).fetchall()
        return {
            int(faiss_id): {
                "id": str(record_id),
                "text": str(text),
                "metadata_json": str(metadata_json),
            }
            for faiss_id, record_id, text, metadata_json in rows
        }

    @staticmethod
    def _search_result_columns(include_vector: bool) -> list[str]:
        columns = ["id", "text", "score", "metadata", "collection_name"]
        if include_vector:
            columns.append("vector")
        return columns

    def _empty_search_result(self, include_vector: bool) -> pd.DataFrame:
        return self.attach_dataframe_schema(pd.DataFrame(columns=self._search_result_columns(include_vector)))
