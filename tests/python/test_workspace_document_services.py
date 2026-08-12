import json
import os
import tempfile
import unittest
from pathlib import Path

import yaml

from app.gui.bridge import BridgeRuntime
from app.services.document_service import DocumentService
from app.services.errors import ApplicationServiceError
from app.services.hidden_value_service import HiddenValueService
from app.services.workspace_service import WorkspaceService


class WorkspaceServiceTests(unittest.TestCase):
    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._temp_dir.name)
        self.root = self.base_dir / "workspace"
        self.root.mkdir()
        self.service = WorkspaceService(self.base_dir)
        self.service.set_root(self.root)

    def tearDown(self):
        self._temp_dir.cleanup()

    def test_normalizes_paths_and_returns_schema_fields(self):
        written = self.service.write_text(
            scope="root",
            rel_path=r"flows\sample.md",
            content="# sample",
        )
        listed = self.service.list_entries(scope="root", rel_path="flows")
        read = self.service.read_text(
            scope="root",
            rel_path="flows/sample.md",
        )

        self.assertEqual(written["rel_path"], "flows/sample.md")
        self.assertEqual(read["content"], "# sample")
        self.assertEqual(listed["rel_path"], "flows")
        self.assertNotIn("base_path", listed)
        self.assertNotIn("path", listed)
        self.assertEqual(listed["entries"][0]["mtime_ns"], read["mtime_ns"])
        self.assertTrue(listed["entries"][0]["modified_at"].endswith("Z"))

    def test_write_detects_mtime_conflict(self):
        initial = self.service.write_text(
            scope="root",
            rel_path="sample.sql",
            content="select 1",
        )

        with self.assertRaises(ApplicationServiceError) as raised:
            self.service.write_text(
                scope="root",
                rel_path="sample.sql",
                content="select 2",
                expected_mtime_ns=str(int(initial["mtime_ns"]) - 1),
            )

        self.assertEqual(raised.exception.code, "E_CONFLICT")
        self.assertEqual(
            self.service.read_text(
                scope="root",
                rel_path="sample.sql",
            )["content"],
            "select 1",
        )

    def test_rejects_absolute_and_parent_relative_paths(self):
        with self.assertRaises(ValueError):
            self.service.read_text(
                scope="root",
                rel_path="../outside.md",
            )
        with self.assertRaises(ValueError):
            self.service.read_text(
                scope="root",
                rel_path=str((self.base_dir / "outside.md").resolve()),
            )


class DocumentServiceTests(unittest.TestCase):
    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._temp_dir.name)
        self.root = self.base_dir / "workspace"
        self.root.mkdir()
        self.workspace_service = WorkspaceService(self.base_dir)
        self.workspace_service.set_root(self.root)
        self.hidden_service = HiddenValueService()
        self.closed_sessions = []
        self.registered_paths = []
        self.service = DocumentService(
            self.workspace_service,
            self.hidden_service,
            close_callback=self.closed_sessions.append,
            register_recent_document=lambda path, **_: self.registered_paths.append(path),
        )

    def tearDown(self):
        self._temp_dir.cleanup()

    def _write_document(self, rel_path="sample.zizd"):
        source_path = self.root / rel_path
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text(
            "\n".join([
                "metadata:",
                "  mode: dataflow",
                "steps:",
                "  - step_id: '01'",
                "    connector: csv_connector",
                "    action: read_csv",
                "    params:",
                "      file_path: C:/data/input.csv",
                "flows: {}",
                "",
            ]),
            encoding="utf-8",
        )
        return source_path

    def test_load_save_and_close_keep_hidden_values_out_of_zizd(self):
        self._write_document()

        loaded = self.service.load_document(
            doc_session_id="docsession_01",
            scope="root",
            rel_path="sample.zizd",
        )
        hidden_ref = loaded["document"]["steps"][0]["params"]["file_path"]
        self.assertTrue(hidden_ref.startswith("{{hidden."))
        self.assertIn(hidden_ref, loaded["hidden_bindings"])
        self.assertTrue(loaded["document_ref"].startswith("docref_"))
        self.assertEqual(
            loaded["mtime_ns"],
            str(int((self.root / "sample.zizd").stat().st_mtime_ns)),
        )

        saved = self.service.save_document(
            doc_session_id="docsession_01",
            document_ref=loaded["document_ref"],
            mode="dataflow",
            scope="root",
            rel_path="saved.zizd",
            file_name="saved.zizd",
            document=loaded["document"],
        )
        persisted = yaml.safe_load(
            (self.root / "saved.zizd").read_text(encoding="utf-8")
        )

        self.assertTrue(saved["saved"])
        self.assertEqual(
            persisted["steps"][0]["params"]["file_path"],
            "C:/data/input.csv",
        )
        self.assertNotIn("{{hidden.", (self.root / "saved.zizd").read_text(encoding="utf-8"))
        self.assertEqual(
            saved["mtime_ns"],
            str(int((self.root / "saved.zizd").stat().st_mtime_ns)),
        )

        closed = self.service.close_document(doc_session_id="docsession_01")
        self.assertTrue(closed["closed"])
        self.assertEqual(self.closed_sessions, ["docsession_01"])
        self.assertNotIn("docsession_01", self.hidden_service.sessions)

    def test_list_returns_document_tokens(self):
        document_path = self._write_document()
        service = DocumentService(
            self.workspace_service,
            self.hidden_service,
            list_recent_documents=lambda: [{
                "filename": document_path.name,
                "path": str(document_path),
                "directory": str(document_path.parent),
                "modified_at": document_path.stat().st_mtime,
            }],
            register_recent_document=lambda *_args, **_kwargs: None,
        )

        result = service.list_documents(scope="local", kind="recent")

        token = result["items"][0]["document_token"]
        self.assertTrue(token.startswith("doctok_"))
        self.assertNotIn("path", result["items"][0])

    def test_save_rejects_external_update_of_loaded_path(self):
        source_path = self._write_document()
        loaded = self.service.load_document(
            doc_session_id="docsession_01",
            scope="root",
            rel_path="sample.zizd",
        )
        source_path.write_text(
            source_path.read_text(encoding="utf-8") + "# external\n",
            encoding="utf-8",
        )
        stat = source_path.stat()
        os.utime(
            source_path,
            ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000),
        )

        with self.assertRaises(ApplicationServiceError) as raised:
            self.service.save_document(
                doc_session_id="docsession_01",
                document_ref=loaded["document_ref"],
                mode="dataflow",
                scope="root",
                rel_path="sample.zizd",
                file_name="sample.zizd",
                document=loaded["document"],
            )

        self.assertEqual(raised.exception.code, "E_CONFLICT")

    def test_successful_save_updates_session_mtime_baseline(self):
        self._write_document()
        loaded = self.service.load_document(
            doc_session_id="docsession_01",
            scope="root",
            rel_path="sample.zizd",
        )

        first = self.service.save_document(
            doc_session_id="docsession_01",
            document_ref=loaded["document_ref"],
            mode="dataflow",
            scope="root",
            rel_path="sample.zizd",
            file_name="sample.zizd",
            document=loaded["document"],
        )
        second = self.service.save_document(
            doc_session_id="docsession_01",
            document_ref=loaded["document_ref"],
            mode="dataflow",
            scope="root",
            rel_path="sample.zizd",
            file_name="sample.zizd",
            document=loaded["document"],
        )

        self.assertTrue(first["saved"])
        self.assertTrue(second["saved"])
        self.assertEqual(
            self.service.get_session("docsession_01")["mtime_ns"],
            second["mtime_ns"],
        )


class WorkspaceDocumentsBridgeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._temp_dir.name)
        self.root = self.base_dir / "workspace"
        self.root.mkdir()
        (self.root / "sample.zizd").write_text(
            "metadata:\n  mode: dataflow\nsteps: []\nflows: {}\n",
            encoding="utf-8",
        )
        self.runtime = BridgeRuntime(base_dir=self.base_dir)
        self.runtime.workspace_root = self.root
        self.runtime.document_service.register_recent_document = (
            lambda *_args, **_kwargs: None
        )

    def tearDown(self):
        self._temp_dir.cleanup()

    def _dispatch(self, command, payload):
        response = self.runtime.handle_message(json.dumps({
            "v": "1",
            "kind": "cmd",
            "id": "cmd_test",
            "type": command,
            "ts": "2026-07-29T00:00:00Z",
            "payload": payload,
        }))
        return response

    def test_documents_commands_use_service_contract(self):
        loaded = self._dispatch("documents.load", {
            "doc_session_id": "docsession_01",
            "scope": "root",
            "rel_path": "sample.zizd",
        })
        self.assertTrue(loaded["ok"])
        self.assertIn("document", loaded["data"])
        self.assertNotIn("flow", loaded["data"])

        saved = self._dispatch("documents.save", {
            "doc_session_id": "docsession_01",
            "document_ref": loaded["data"]["document_ref"],
            "mode": "dataflow",
            "scope": "root",
            "rel_path": "saved.zizd",
            "file_name": "saved.zizd",
            "document": loaded["data"]["document"],
        })
        self.assertTrue(saved["ok"])
        self.assertTrue(saved["data"]["saved"])

        closed = self._dispatch("documents.close", {
            "doc_session_id": "docsession_01",
        })
        self.assertTrue(closed["ok"])
        self.assertTrue(closed["data"]["closed"])

    def test_documents_location_requires_scope_and_rel_path_pair(self):
        response = self._dispatch("documents.load", {
            "doc_session_id": "docsession_01",
            "rel_path": "sample.zizd",
        })

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "E_VALIDATION")

    def test_old_flow_load_command_is_not_registered(self):
        response = self._dispatch("flow.load", {
            "workspace_tab_id": "tab_01",
            "scope": "root",
            "rel_path": "sample.zizd",
        })

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "E_ACCESS_DENIED")


if __name__ == "__main__":
    unittest.main()
