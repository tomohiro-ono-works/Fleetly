import unittest

import pandas as pd

from connectors.base_connector import BaseConnector


class SchemaApplyCommonTests(unittest.TestCase):
    def test_schema_apply_selects_converts_and_renames(self):
        dataframe = pd.DataFrame([
            {"a": "1", "b": "x", "c": "2026/06/11"},
            {"a": "2", "b": "y", "c": "2026/06/12"},
        ])
        schema = [
            {"origin_name": "a", "new_name": "amount", "ziz_datatype": "INT64"},
            {"origin_name": "c", "new_name": "order_date", "ziz_datatype": "DATE"},
        ]

        result = BaseConnector.apply_schema_to_dataframe(
            dataframe,
            schema,
        )

        self.assertEqual(list(result.columns), ["amount", "order_date"])
        self.assertEqual(str(result["amount"].dtype), "Int64")
        self.assertEqual(result.iloc[0]["amount"], 1)
        self.assertEqual(str(result.iloc[0]["order_date"])[:10], "2026-06-11")
        self.assertEqual(result.attrs["ziz_date_parse_metrics"]["target_columns"], 1)

    def test_schema_apply_raises_on_missing_columns(self):
        dataframe = pd.DataFrame([
            {"a": "1", "b": "x"},
        ])
        schema = [
            {"origin_name": "not_exists", "new_name": "value", "ziz_datatype": "STRING"},
        ]

        with self.assertRaises(ValueError) as error:
            BaseConnector.apply_schema_to_dataframe(dataframe, schema)
        message = str(error.exception)
        self.assertIn("schema適用エラー(列存在チェック)", message)
        self.assertIn("not_exists", message)


if __name__ == "__main__":
    unittest.main()
