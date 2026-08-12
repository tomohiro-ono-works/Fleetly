import logging
import uuid

from app.gui.bridge_security import BridgeSecurityPolicy
from app.gui.bridge_contract import (
    PROTOCOL_VERSION,
    ContractValidationError,
    build_failure_response,
    build_success_response,
    parse_command,
)
from app.services.errors import ApplicationServiceError
from shared.security_sanitizer import SensitiveDataSanitizer


logger = logging.getLogger("ziz.bridge_dispatcher")


def _new_trace_id():
    return f"trace_{uuid.uuid4().hex}"


class BridgeCommandDispatcher:
    def __init__(
        self,
        handlers,
        *,
        protocol_version=PROTOCOL_VERSION,
        command_observer=None,
        error_observer=None,
        security_policy=None,
        security_observer=None,
        sanitizer=None,
    ):
        self._handlers = {
            str(message_type): handler
            for message_type, handler in dict(handlers or {}).items()
            if str(message_type).strip() and callable(handler)
        }
        self._protocol_version = str(protocol_version)
        self._command_observer = command_observer
        self._error_observer = error_observer
        self._security_policy = security_policy or BridgeSecurityPolicy()
        self._security_observer = security_observer
        self._sanitizer = sanitizer or SensitiveDataSanitizer()

    @property
    def command_types(self):
        return tuple(sorted(self._handlers))

    @property
    def command_profiles(self):
        profiles = self._security_policy.command_profiles
        return {
            command_type: profiles[command_type]
            for command_type in self.command_types
            if command_type in profiles
        }

    def dispatch_raw(self, raw_text):
        try:
            command = parse_command(raw_text, protocol_version=self._protocol_version)
        except ContractValidationError as error:
            trace_id = _new_trace_id()
            self._notify_security(
                error.message_type,
                "unknown",
                "denied",
                error.code,
                trace_id,
            )
            return build_failure_response(
                error.message_id,
                error.message_type,
                error.code,
                self._sanitizer.sanitize_text(error.message, mask_paths=True),
                trace_id,
                protocol_version=self._protocol_version,
            )
        return self.dispatch(command)

    def dispatch(self, command):
        trace_id = _new_trace_id()
        handler = self._handlers.get(command.message_type)
        if handler is None:
            self._notify_security(
                command.message_type,
                "unknown",
                "denied",
                "E_ACCESS_DENIED",
                trace_id,
            )
            return build_failure_response(
                command.message_id,
                command.message_type,
                "E_ACCESS_DENIED",
                "未許可のcommandです。",
                trace_id,
                protocol_version=self._protocol_version,
            )

        profile = self._security_policy.command_profiles.get(
            command.message_type,
            "unknown",
        )
        try:
            profile = self._security_policy.validate(
                command.message_type,
                command.payload,
            )
        except ApplicationServiceError as error:
            self._notify_security(
                command.message_type,
                profile,
                "denied",
                error.code,
                trace_id,
            )
            return self._failure(command, error.code, error.message, trace_id)
        except ValueError as error:
            self._notify_security(
                command.message_type,
                profile,
                "denied",
                "E_VALIDATION",
                trace_id,
            )
            return self._failure(command, "E_VALIDATION", str(error), trace_id)

        self._notify_security(
            command.message_type,
            profile,
            "allowed",
            "",
            trace_id,
        )
        if self._command_observer:
            self._command_observer(command.message_type, command.payload)

        try:
            data = handler(command.payload)
        except ApplicationServiceError as error:
            return self._failure(command, error.code, error.message, trace_id)
        except ValueError as error:
            return self._failure(command, "E_VALIDATION", str(error), trace_id)
        except FileNotFoundError as error:
            return self._failure(command, "E_NOT_FOUND", str(error), trace_id)
        except PermissionError as error:
            return self._failure(command, "E_ACCESS_DENIED", str(error), trace_id)
        except Exception:
            logger.exception("command dispatch failed: type=%s trace_id=%s", command.message_type, trace_id)
            return self._failure(command, "E_INTERNAL", "内部エラーが発生しました。", trace_id)

        return build_success_response(
            command.message_id,
            command.message_type,
            self._sanitizer.sanitize_structure(data, mask_paths=False),
            trace_id,
            protocol_version=self._protocol_version,
        )

    def _failure(self, command, code, message, trace_id):
        if self._error_observer:
            self._error_observer(
                command.message_type,
                command.payload,
                code,
                message,
            )
        return build_failure_response(
            command.message_id,
            command.message_type,
            code,
            self._sanitizer.sanitize_text(message, mask_paths=True),
            trace_id,
            protocol_version=self._protocol_version,
        )

    def _notify_security(self, message_type, profile, decision, reason, trace_id):
        if not self._security_observer:
            return
        self._security_observer(
            str(message_type or "unknown"),
            str(profile or "unknown"),
            str(decision or ""),
            str(reason or ""),
            str(trace_id or ""),
        )
