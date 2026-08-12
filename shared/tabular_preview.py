def is_dataframe_like(value):
    return (
        hasattr(value, "columns")
        and hasattr(value, "head")
        and hasattr(value, "attrs")
    )


def build_dataframe_ui_cache(dataframe, *, max_rows=100):
    try:
        preview = dataframe.head(max(1, int(max_rows)))
        columns = [str(column) for column in preview.columns]
        rows = []
        for _, row in preview.iterrows():
            rows.append([
                "" if _is_missing(value) else str(value)
                for value in row.tolist()
            ])
        existing_schema = dataframe.attrs.get("ziz_schema")
        if isinstance(existing_schema, list) and existing_schema:
            schema_items = existing_schema
        else:
            schema_items = [
                {
                    "origin_name": str(column),
                    "new_name": str(column),
                    "description": str(column),
                    "ziz_datatype": str(
                        getattr(dataframe[column], "dtype", "") or ""
                    ),
                }
                for column in dataframe.columns
            ]
        return {
            "kind": "dataframe",
            "preview": {
                "columns": columns,
                "rows": rows,
                "row_count": len(rows),
                "truncated": bool(len(dataframe.index) > len(rows)),
            },
            "schema": {
                "columns": [_normalize_schema_item(item) for item in schema_items]
            },
            "row_count": int(len(dataframe.index)),
        }
    except Exception:
        return {
            "kind": "dataframe",
            "preview": {
                "columns": [],
                "rows": [],
                "row_count": 0,
                "truncated": False,
            },
            "schema": {"columns": []},
            "row_count": 0,
        }


def _normalize_schema_item(item):
    source = item if isinstance(item, dict) else {}
    origin_name = str(
        source.get("origin_name")
        or source.get("name_ja")
        or source.get("name_en")
        or ""
    )
    return {
        "origin_name": origin_name,
        "new_name": str(
            source.get("new_name")
            or source.get("name_en")
            or origin_name
        ),
        "description": str(
            source.get("description")
            or source.get("name_ja")
            or origin_name
        ),
        "ziz_datatype": str(source.get("ziz_datatype") or ""),
    }


def _is_missing(value):
    if value is None:
        return True
    try:
        result = value != value
    except Exception:
        return False
    try:
        return bool(result)
    except Exception:
        return False
