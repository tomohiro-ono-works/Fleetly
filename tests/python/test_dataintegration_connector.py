import unittest
from pathlib import Path

import pandas as pd

from connectors.dataintegration_connector import DataintegrationConnector


class DataintegrationConnectorTests(unittest.TestCase):
    def setUp(self):
        self.connector = DataintegrationConnector()
        self.test_dir = Path(__file__).resolve().parent
        self.base_dataframe = pd.DataFrame(
            [
                {"日付": "2026-04-01", "age": 10, "city": "Tokyo", "name": "Taro"},
                {"日付": "2026-04-02", "age": 25, "city": "Osaka", "name": "Hanako"},
                {"日付": "2026-04-03", "age": 30, "city": "Tokyo", "name": "Jiro"},
            ]
        )

    def test_replace_fields_forrenamelist_applies_csv_rename_list(self):
        rename_csv = self.test_dir / "_tmp_rename.csv"
        rename_csv.write_text(
            "origin_name,replaced_name,description,ziz_datatype\n"
            "日付,order_date,受注日,DATE\n"
            "age,age,年齢,INT64\n"
            "city,city_name,都市,STRING\n",
            encoding="utf-8"
        )
        self.addCleanup(lambda: rename_csv.unlink(missing_ok=True))

        result = self.connector.execute(
            "replace_fields_forrenamelist",
            {
                "input_data": "step1",
                "rename_list_path": str(rename_csv),
            },
            {"step1": self.base_dataframe},
        )

        self.assertListEqual(list(result.columns), ["order_date", "age", "city_name", "name"])
        self.assertEqual(str(result["age"].dtype), "Int64")
        self.assertEqual(len(result.attrs.get("ziz_schema") or []), 4)

    def test_filter_rows_supports_exact_contains_and_range(self):
        result = self.connector.execute(
            "filter_rows",
            {
                "input_data": "step1",
                "conditions": [
                    {"field": "city", "operator": "exact", "value": "Tokyo", "value_to": ""},
                    {"field": "name", "operator": "contains", "value": "r", "value_to": ""},
                    {"field": "age", "operator": "range", "value": "5", "value_to": "20"},
                ],
            },
            {"step1": self.base_dataframe},
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["name"], "Taro")

    def test_filter_rows_supports_prefix_and_suffix(self):
        result = self.connector.execute(
            "filter_rows",
            {
                "input_data": "step1",
                "conditions": [
                    {"field": "city", "operator": "prefix", "value": "To", "value_to": ""},
                    {"field": "name", "operator": "suffix", "value": "o", "value_to": ""},
                ],
            },
            {"step1": self.base_dataframe},
        )

        self.assertEqual(len(result), 2)
        self.assertListEqual(result["name"].tolist(), ["Taro", "Jiro"])


if __name__ == "__main__":
    unittest.main()
