import ast
import inspect
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from PySide6.QtCore import QCoreApplication, QMetaMethod
from PySide6.QtWebChannel import QWebChannel

import app.gui.bridge_contract as bridge_contract_module
import app.gui.bridge_dispatcher as bridge_dispatcher_module
from app.gui.bridge import BridgeRuntime
from app.gui.bridge_contract import (
    ContractValidationError,
    build_event,
    parse_command,
)
from app.gui.bridge_dispatcher import BridgeCommandDispatcher
from app.gui.qwebchannel_transport import QWebChannelTransport
from app.services.errors import ApplicationServiceError


def _command(message_type="app.getStatus", payload=None, **overrides):
    message = {
        "v": "1",
        "kind": "cmd",
        "id": "cmd_01",
        "type": message_type,
        "ts": "2026-07-29T00:00:00Z",
        "payload": payload or {},
    }
    message.update(overrides)
    return json.dumps(message, ensure_ascii=False)


def _wait_for(predicate, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        QCoreApplication.processEvents()
        if predicate():
            return True
        time.sleep(0.01)
    QCoreApplication.processEvents()
    return bool(predicate())


class BridgeContractTests(unittest.TestCase):
    def test_parse_command_validates_envelope(self):
        command = parse_command(_command(payload={"value": 1}))

        self.assertEqual(command.version, "1")
        self.assertEqual(command.message_id, "cmd_01")
        self.assertEqual(command.message_type, "app.getStatus")
        self.assertEqual(command.payload, {"value": 1})

    def test_parse_command_rejects_version_and_unknown_field(self):
        with self.assertRaises(ContractValidationError) as version_error:
            parse_command(_command(v="1.0"))
        self.assertEqual(version_error.exception.code, "E_CONTRACT_VERSION_MISMATCH")

        with self.assertRaises(ContractValidationError) as field_error:
            parse_command(_command(extra=True))
        self.assertEqual(field_error.exception.code, "E_VALIDATION")


class BridgeDispatcherTests(unittest.TestCase):
    class _AllowSecurityPolicy:
        command_profiles = {}

        def validate(self, command_type, payload):
            return "read"

    def test_dispatch_preserves_response_correlation(self):
        dispatcher = BridgeCommandDispatcher({
            "sample.echo": lambda payload: {"echo": payload["value"]},
        }, security_policy=self._AllowSecurityPolicy())

        response = dispatcher.dispatch_raw(_command("sample.echo", {"value": "ok"}))

        self.assertEqual(response["v"], "1")
        self.assertEqual(response["kind"], "res")
        self.assertEqual(response["id"], "cmd_01")
        self.assertEqual(response["type"], "sample.echo")
        self.assertTrue(response["ok"])
        self.assertEqual(response["data"], {"echo": "ok"})
        self.assertTrue(response["trace_id"].startswith("trace_"))

    def test_dispatch_maps_validation_service_and_unknown_errors(self):
        handlers = {
            "sample.validation": lambda payload: (_ for _ in ()).throw(ValueError("invalid")),
            "sample.conflict": lambda payload: (_ for _ in ()).throw(
                ApplicationServiceError("E_CONFLICT", "running")
            ),
        }
        dispatcher = BridgeCommandDispatcher(
            handlers,
            security_policy=self._AllowSecurityPolicy(),
        )

        validation = dispatcher.dispatch_raw(_command("sample.validation"))
        conflict = dispatcher.dispatch_raw(_command("sample.conflict"))
        unknown = dispatcher.dispatch_raw(_command("sample.unknown"))

        self.assertEqual(validation["error"]["code"], "E_VALIDATION")
        self.assertEqual(conflict["error"]["code"], "E_CONFLICT")
        self.assertEqual(unknown["error"]["code"], "E_ACCESS_DENIED")
        self.assertFalse(validation["ok"])
        self.assertFalse(conflict["ok"])
        self.assertFalse(unknown["ok"])


class BridgeRuntimeDispatcherIntegrationTests(unittest.TestCase):
    def test_runtime_uses_dispatcher_and_common_response_contract(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime = BridgeRuntime(base_dir=Path(temp_dir))
            response = runtime.handle_message(_command())

        self.assertEqual(response["v"], "1")
        self.assertTrue(response["ok"])
        self.assertEqual(response["id"], "cmd_01")
        self.assertEqual(response["data"]["protocol_version"], "1")
        self.assertEqual(
            response["data"]["capabilities"],
            list(runtime.dispatcher.command_types),
        )

    def test_runtime_shutdown_cancels_workers_and_rejects_new_run(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime = BridgeRuntime(base_dir=Path(temp_dir))
            cancel_event = threading.Event()
            worker = threading.Thread(
                target=cancel_event.wait,
                daemon=True,
            )
            session = {
                "run_id": "run_shutdown",
                "flow_key": "flow_shutdown",
                "status": "running",
                "cancel_event": cancel_event,
                "thread": worker,
            }
            runtime.execution_manager.register_session(session)
            worker.start()

            shutdown_result = runtime.shutdown(timeout_seconds=1.0)

            self.assertTrue(cancel_event.is_set())
            self.assertFalse(worker.is_alive())
            self.assertEqual(shutdown_result["cancel_requested"], 1)
            self.assertEqual(shutdown_result["remaining_workers"], 0)
            with self.assertRaises(ApplicationServiceError) as error:
                runtime._handle_run_start({})
            self.assertEqual(error.exception.code, "E_NOT_READY")


class _FakeDispatcher:
    def __init__(self):
        self.thread_ids = []

    def dispatch_raw(self, raw_text):
        message = json.loads(raw_text)
        self.thread_ids.append(threading.get_ident())
        return {
            "v": "1",
            "kind": "res",
            "id": message.get("id"),
            "type": message.get("type"),
            "ts": "2026-07-29T00:00:00Z",
            "ok": True,
            "data": {"accepted": True},
            "trace_id": "trace_test",
        }


class QWebChannelTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QCoreApplication.instance() or QCoreApplication([])

    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.dispatcher = _FakeDispatcher()
        self.transport = QWebChannelTransport(
            self.dispatcher,
            base_dir=Path(self._temp_dir.name),
        )
        self.messages = []
        self.transport.messageToFrontend.connect(self.messages.append)

    def tearDown(self):
        self.transport.shutdown()
        self.transport.deleteLater()
        QCoreApplication.processEvents()
        self._temp_dir.cleanup()

    def test_registered_object_exposes_one_custom_slot_and_signal(self):
        channel = QWebChannel()
        channel.registerObject("backendBridge", self.transport)

        self.assertIs(channel.registeredObjects()["backendBridge"], self.transport)
        meta = self.transport.metaObject()
        methods = {}
        for index in range(meta.methodOffset(), meta.methodCount()):
            method = meta.method(index)
            signature = bytes(method.methodSignature()).decode("utf-8")
            methods[signature] = method.methodType()

        self.assertEqual(methods["postMessage(QString)"], QMetaMethod.MethodType.Slot)
        self.assertEqual(methods["messageToFrontend(QString)"], QMetaMethod.MethodType.Signal)
        self.assertEqual(set(methods), {"postMessage(QString)", "messageToFrontend(QString)"})
        channel.deregisterObject(self.transport)

    def test_sync_response_uses_common_contract(self):
        owner_thread_id = threading.get_ident()

        self.transport.postMessage(_command())

        self.assertEqual(self.dispatcher.thread_ids, [owner_thread_id])
        self.assertEqual(len(self.messages), 1)
        response = json.loads(self.messages[0])
        self.assertTrue(response["ok"])
        self.assertEqual(response["id"], "cmd_01")

    def test_async_response_and_worker_event_are_delivered_on_owner_thread(self):
        owner_thread_id = threading.get_ident()
        received_thread_ids = []
        self.transport.messageToFrontend.connect(
            lambda raw_text: received_thread_ids.append(threading.get_ident())
        )

        self.transport.postMessage(_command("preview.readCsv"))
        event_worker = threading.Thread(
            target=lambda: self.transport.publish(build_event("run.progress", {"run_id": "run_1"})),
            daemon=True,
        )
        event_worker.start()
        event_worker.join(timeout=1.0)

        self.assertTrue(_wait_for(lambda: len(self.messages) >= 2))
        self.assertNotEqual(self.dispatcher.thread_ids[0], owner_thread_id)
        self.assertEqual(received_thread_ids, [owner_thread_id, owner_thread_id])
        kinds = {json.loads(raw_text)["kind"] for raw_text in self.messages}
        self.assertEqual(kinds, {"res", "evt"})

    def test_google_auth_status_runs_outside_owner_thread(self):
        owner_thread_id = threading.get_ident()

        self.transport.postMessage(_command("app.googleAuthStatus"))

        self.assertTrue(_wait_for(lambda: len(self.messages) == 1))
        self.assertNotEqual(self.dispatcher.thread_ids[0], owner_thread_id)

    def test_shutdown_rejects_new_command(self):
        self.transport.shutdown()

        self.transport.postMessage(_command())

        self.assertEqual(len(self.messages), 1)
        response = json.loads(self.messages[0])
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "E_NOT_READY")


class BridgeLayerDependencyTests(unittest.TestCase):
    def test_contract_and_dispatcher_do_not_import_qt_core_or_connectors(self):
        for module in (bridge_contract_module, bridge_dispatcher_module):
            tree = ast.parse(inspect.getsource(module))
            imports = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imports.update(alias.name for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imports.add(node.module)

            self.assertFalse(any(name == "PySide6" or name.startswith("PySide6.") for name in imports))
            self.assertFalse(any(name == "core" or name.startswith("core.") for name in imports))
            self.assertFalse(any(name == "connectors" or name.startswith("connectors.") for name in imports))


if __name__ == "__main__":
    unittest.main()
