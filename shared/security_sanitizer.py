import re
from collections.abc import Mapping


MASK = "***********"

_SENSITIVE_KEYS = {
    "access_token",
    "api_key",
    "authorization",
    "client_secret",
    "cookie",
    "credential",
    "credentials",
    "id_token",
    "password",
    "passwd",
    "refresh_token",
    "secret",
    "secret_key",
    "session_cookie",
}
_PATH_KEYS = {
    "current_flow_path",
    "current_value",
    "directory",
    "display_hint",
    "file_path",
    "flow_key",
    "folder_path",
    "output_dir",
    "output_folder",
    "output_path",
    "path",
    "rel_path",
    "resolved_path",
    "root_path",
    "target_path",
}
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(password|passwd|secret|client_secret|access_token|refresh_token|"
    r"id_token|api[_-]?key|authorization|cookie)\s*([:=])\s*"
    r"(\"[^\"]*\"|'[^']*'|[^\s,;&#]+)"
)
_SECRET_QUERY_RE = re.compile(
    r"(?i)([?&](?:access_token|refresh_token|id_token|token|api[_-]?key|"
    r"client_secret|password)=)[^&#\s]+"
)
_PATH_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(path|file_path|folder_path|output_path|root_path|rel_path|"
    r"resolved_path|target_path|current_flow_path|display_hint|flow_key)"
    r"\s*([:=])\s*(\"[^\"]*\"|'[^']*'|[^\s,;]+)"
)
_WINDOWS_PATH_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)[^\r\n]*?"
    r"(?=(?:\s+[A-Za-z_][A-Za-z0-9_.-]*=)|$)"
)
_POSIX_PATH_RE = re.compile(
    r"(?<![:/\w])/(?!/)[^\r\n]*?"
    r"(?=(?:\s+[A-Za-z_][A-Za-z0-9_.-]*=)|$)"
)


def _normalized_key(key):
    return str(key or "").strip().lower().replace("-", "_")


def is_sensitive_key(key):
    normalized = _normalized_key(key)
    return normalized in _SENSITIVE_KEYS or normalized.endswith(("_password", "_secret", "_api_key"))


def is_path_key(key):
    normalized = _normalized_key(key)
    return (
        normalized in _PATH_KEYS
        or normalized.endswith(("_path", "_directory", "_folder"))
    )


class SensitiveDataSanitizer:
    def sanitize_text(self, value, *, secrets=(), mask_paths=True):
        text = str(value or "")
        targets = set()
        for secret in secrets or ():
            normalized = str(secret or "").strip()
            if not normalized:
                continue
            targets.add(normalized)
            targets.add(normalized.replace("\\", "/"))
            targets.add(normalized.replace("/", "\\"))
        for target in sorted(targets, key=len, reverse=True):
            text = text.replace(target, MASK)

        text = _BEARER_RE.sub(f"Bearer {MASK}", text)
        text = _SECRET_ASSIGNMENT_RE.sub(
            lambda match: f"{match.group(1)}{match.group(2)}{MASK}",
            text,
        )
        text = _SECRET_QUERY_RE.sub(lambda match: f"{match.group(1)}{MASK}", text)
        if mask_paths:
            text = _PATH_ASSIGNMENT_RE.sub(
                lambda match: f"{match.group(1)}{match.group(2)}{MASK}",
                text,
            )
            text = _WINDOWS_PATH_RE.sub(MASK, text)
            text = _POSIX_PATH_RE.sub(MASK, text)
        return text

    def sanitize_structure(self, value, *, secrets=(), mask_paths=True):
        if isinstance(value, Mapping):
            sanitized = {}
            for key, item in value.items():
                if is_sensitive_key(key):
                    sanitized[key] = MASK if item not in (None, "") else item
                    continue
                if mask_paths and is_path_key(key) and item not in (None, ""):
                    sanitized[key] = MASK
                    continue
                sanitized[key] = self.sanitize_structure(
                    item,
                    secrets=secrets,
                    mask_paths=mask_paths,
                )
            return sanitized
        if isinstance(value, list):
            return [
                self.sanitize_structure(item, secrets=secrets, mask_paths=mask_paths)
                for item in value
            ]
        if isinstance(value, tuple):
            return [
                self.sanitize_structure(item, secrets=secrets, mask_paths=mask_paths)
                for item in value
            ]
        if isinstance(value, str):
            return self.sanitize_text(value, secrets=secrets, mask_paths=mask_paths)
        return value
