import tempfile
import unittest
from pathlib import Path

from connectors.csv_connector import CSVConnector


class CSVConnectorTests(unittest.TestCase):
    def _temp_csv_path(self):
        handle = tempfile.NamedTemporaryFile(suffix=".csv", delete=False, mode="w", encoding="utf-8", newline="")
        handle.write("id,name\n")
        for index in range(5):
            handle.write(f"{index},name-{index}\n")
        handle.close()
        path = Path(handle.name)
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        return path

    def test_read_csv_chunks_rows_and_logs_progress(self):
        connector = CSVConnector()
        events = []
        connector.set_execution_logger(None, "step1", lambda event, detail: events.append((event, detail)))
        path = self._temp_csv_path()

        result = connector.read_csv(
            str(path),
            encoding="utf-8",
            delimiter=",",
            header_row=1,
            data_start_row=2,
            chunk_size=2,
            date_cleansing=False,
        )

        self.assertEqual(result.shape, (5, 2))
        chunk_events = [detail for event, detail in events if event == "run.connector.chunk.finish"]
        self.assertEqual([event["rows"] for event in chunk_events], [2, 2, 1])
        self.assertEqual(chunk_events[-1]["total_rows"], 5)
        connector.clear_execution_logger()


if __name__ == "__main__":
    unittest.main()
