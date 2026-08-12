import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.gui.bridge import BridgeRuntime
from app.gui.bridge_dispatcher import BridgeCommandDispatcher
from app.gui.bridge_security import (
    BridgeSecurityPolicy,
    EXECUTE,
    HOST,
    is_safe_external_url,
)
from app.gui.host_navigation import (
    ALLOW,
    BLOCK,
    OPEN_EXTERNAL,
    TrustedNavigationPolicy,
)
from app.gui.host import _configure_qtwebengine_environment
from app.services.errors import ApplicationServiceError
from shared.security_sanitizer import MASK, SensitiveDataSanitizer


def _command(message_type, payload=None, **overrides):
    message = {
        "v": "1",
        "kind": "cmd",
        "id": "cmd_security_01",
        "type": message_type,
        "ts": "2026-07-29T00:00:00Z",
        "payload": payload or {},
    }
    message.update(overrides)
    return json.dumps(message, ensure_ascii=False)


class BridgeSecurityPolicyTests(unittest.TestCase):
    def test_runtime_handlers_all_have_backend_profiles(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime = BridgeRuntime(base_dir=Path(temp_dir))

        self.assertEqual(
            set(runtime.dispatcher.command_types),
            set(runtime.dispatcher.command_profiles),
        )

    def test_invalid_payload_is_rejected_before_handler(self):
        calls = []
        dispatcher = BridgeCommandDispatcher({
            "app.getStatus": lambda payload: calls.append(payload) or {"ready": True},
        })

        response = dispatcher.dispatch_raw(_command(
            "app.getStatus",
            {"security_profile_id": "execute"},
        ))

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "E_VALIDATION")
        self.assertEqual(calls, [])

    def test_missing_host_capability_is_rejected_before_handler(self):
        calls = []
        dispatcher = BridgeCommandDispatcher({
            "app.windowControl": lambda payload: calls.append(payload) or {},
        })

        response = dispatcher.dispatch_raw(_command(
            "app.windowControl",
            {"action": "close"},
        ))

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "E_NOT_READY")
        self.assertEqual(calls, [])

    def test_external_open_requires_host_capability(self):
        payload = {
            "url": "https://example.com/path",
            "prefer": "chrome",
        }

        with self.assertRaises(ApplicationServiceError) as context:
            BridgeSecurityPolicy().validate("app.openExternal", payload)

        self.assertEqual(context.exception.code, "E_NOT_READY")
        self.assertEqual(
            BridgeSecurityPolicy(
                capabilities={"external_open"}
            ).validate("app.openExternal", payload),
            HOST,
        )

    def test_run_start_workflow_structure_is_validated(self):
        policy = BridgeSecurityPolicy()
        valid_payload = {
            "doc_session_id": "docsession_1",
            "flow_id": "01",
            "document": {
                "steps": [{
                    "step_id": "01",
                    "connector_id": "CSVConnector",
                    "action_id": "read_csv",
                    "params": {"file_path": "C:/input.csv"},
                }],
                "flows": {"01": {"edges": []}},
            },
        }

        profile = policy.validate("run.start", valid_payload)

        self.assertEqual(profile, EXECUTE)
        invalid_payload = {
            "doc_session_id": "docsession_1",
            "flow_id": "01",
            "document": {
                "steps": [{"step_id": "01", "params": {}}],
                "flows": {"01": {"edges": []}},
            },
        }
        with self.assertRaises(ValueError):
            policy.validate("run.start", invalid_payload)

    def test_relative_path_traversal_and_unsafe_external_url_are_rejected(self):
        policy = BridgeSecurityPolicy()

        with self.assertRaises(ValueError):
            policy.validate(
                "workspace.readText",
                {"scope": "root", "rel_path": "../outside.txt"},
            )
        self.assertFalse(is_safe_external_url("javascript:alert(1)"))
        self.assertFalse(is_safe_external_url("https://user:pass@example.com/"))
        self.assertTrue(is_safe_external_url("https://example.com/path?q=1"))


class BridgeSanitizerTests(unittest.TestCase):
    def test_sanitizer_masks_secrets_and_log_paths_but_preserves_opaque_ids(self):
        sanitizer = SensitiveDataSanitizer()
        value = {
            "document_token": "doctok_1",
            "access_token": "secret-token",
            "root_path": r"C:\Users\alice\workspace",
        }

        response_value = sanitizer.sanitize_structure(value, mask_paths=False)
        log_value = sanitizer.sanitize_structure(value, mask_paths=True)

        self.assertEqual(response_value["document_token"], "doctok_1")
        self.assertEqual(response_value["access_token"], MASK)
        self.assertEqual(response_value["root_path"], value["root_path"])
        self.assertEqual(log_value["root_path"], MASK)
        self.assertEqual(
            sanitizer.sanitize_text(
                "https://example.com/?access_token=abc&view=1",
                mask_paths=False,
            ),
            f"https://example.com/?access_token={MASK}&view=1",
        )

    def test_dispatcher_masks_error_path_and_secret_response_fields(self):
        dispatcher = BridgeCommandDispatcher({
            "app.getStatus": lambda payload: {
                "root_path": r"C:\Users\alice\workspace",
                "access_token": "secret-token",
            },
            "workspace.getRoot": lambda payload: (_ for _ in ()).throw(
                FileNotFoundError(r"C:\Users\alice\workspace\missing.txt")
            ),
        })

        status = dispatcher.dispatch_raw(_command("app.getStatus"))
        missing = dispatcher.dispatch_raw(_command("workspace.getRoot"))

        self.assertTrue(status["ok"])
        self.assertEqual(status["data"]["root_path"], r"C:\Users\alice\workspace")
        self.assertEqual(status["data"]["access_token"], MASK)
        self.assertNotIn(r"C:\Users\alice", missing["error"]["message"])
        self.assertIn(MASK, missing["error"]["message"])

    def test_runtime_masks_event_paths(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime = BridgeRuntime(base_dir=Path(temp_dir))
            events = []
            runtime.set_event_sink(events.append)

            runtime.emit_event("run.log", {
                "run_id": "run_1",
                "path": r"C:\Users\alice\workspace\result.csv",
                "access_token": "secret-token",
            })

        self.assertEqual(events[0]["payload"]["path"], MASK)
        self.assertEqual(events[0]["payload"]["access_token"], MASK)


class HostNavigationPolicyTests(unittest.TestCase):
    def test_remote_debugging_environment_is_removed(self):
        with patch.dict(os.environ, {
            "QTWEBENGINE_REMOTE_DEBUGGING": "9222",
            "QTWEBENGINE_CHROMIUM_FLAGS": (
                "--remote-debugging-port=9222 --remote-allow-origins=* --disable-gpu"
            ),
        }, clear=False):
            _configure_qtwebengine_environment()

            self.assertNotIn("QTWEBENGINE_REMOTE_DEBUGGING", os.environ)
            flags = os.environ["QTWEBENGINE_CHROMIUM_FLAGS"]
            self.assertNotIn("--remote-debugging-port", flags)
            self.assertNotIn("--remote-allow-origins", flags)
            self.assertIn("--disable-gpu", flags)

    def test_only_bundled_pages_can_be_main_frame(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            asset_root = Path(temp_dir) / "static"
            asset_root.mkdir()
            home = asset_root / "home.html"
            dataflow = asset_root / "dataflow.html"
            script = asset_root / "js" / "app.js"
            arbitrary = asset_root / "preview.html"
            outside = Path(temp_dir) / "outside.html"
            script.parent.mkdir()
            for path in (home, dataflow, script, arbitrary, outside):
                path.write_text("", encoding="utf-8")
            policy = TrustedNavigationPolicy(asset_root, home)

            self.assertEqual(
                policy.classify(
                    url_text=home.as_uri(),
                    scheme="file",
                    local_file=str(home),
                    is_main_frame=True,
                ),
                ALLOW,
            )
            self.assertEqual(
                policy.classify(
                    url_text=dataflow.as_uri(),
                    scheme="file",
                    local_file=str(dataflow),
                    is_main_frame=True,
                ),
                ALLOW,
            )
            self.assertEqual(
                policy.classify(
                    url_text=arbitrary.as_uri(),
                    scheme="file",
                    local_file=str(arbitrary),
                    is_main_frame=True,
                ),
                BLOCK,
            )
            self.assertFalse(policy.allow_request(
                url_text=outside.as_uri(),
                scheme="file",
                local_file=str(outside),
            ))
            self.assertTrue(policy.allow_request(
                url_text=script.as_uri(),
                scheme="file",
                local_file=str(script),
            ))

    def test_remote_navigation_is_external_and_remote_resources_are_blocked(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            asset_root = Path(temp_dir)
            home = asset_root / "home.html"
            home.write_text("", encoding="utf-8")
            policy = TrustedNavigationPolicy(asset_root, home)

            self.assertEqual(
                policy.classify(
                    url_text="https://example.com/",
                    scheme="https",
                    is_main_frame=True,
                ),
                OPEN_EXTERNAL,
            )
            self.assertEqual(
                policy.classify(
                    url_text="https://example.com/app.js",
                    scheme="https",
                    is_main_frame=False,
                ),
                BLOCK,
            )
            self.assertFalse(policy.allow_request(
                url_text="https://example.com/app.js",
                scheme="https",
            ))

    def test_production_pages_define_restrictive_csp(self):
        repo_root = Path(__file__).resolve().parents[2]
        for name in ("home.html", "dataflow.html", "settings.html"):
            html = (repo_root / "static" / name).read_text(encoding="utf-8")
            self.assertIn("Content-Security-Policy", html)
            self.assertIn("connect-src 'none'", html)
            self.assertIn("object-src 'none'", html)
            self.assertNotIn("script-src 'unsafe-inline'", html)


class WorkspaceSecurityTests(unittest.TestCase):
    def test_directory_delete_requires_recursive_true(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "workspace"
            target = root / "folder"
            target.mkdir(parents=True)
            runtime = BridgeRuntime(base_dir=Path(temp_dir))
            runtime.workspace_root = root

            with self.assertRaises(ValueError):
                runtime._handle_workspace_delete({
                    "scope": "root",
                    "rel_path": "folder",
                })
            result = runtime._handle_workspace_delete({
                "scope": "root",
                "rel_path": "folder",
                "recursive": True,
            })

        self.assertTrue(result["deleted"])
        self.assertEqual(result["kind"], "dir")


if __name__ == "__main__":
    unittest.main()
