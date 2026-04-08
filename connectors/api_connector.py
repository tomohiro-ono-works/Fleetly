from __future__ import annotations

import json
from typing import Any
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from connectors.base_connector import BaseConnector
from core.security_policies import get_api_profile, is_web_target_allowed


class APIConnector(BaseConnector):
    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if action != "run_api":
            raise ValueError(f"Unknown action: {action}")
        return self.run_api(params)

    @staticmethod
    def _required_text(params: dict[str, Any], key: str) -> str:
        text = str(params.get(key) or "").strip()
        if not text:
            raise ValueError(f"{key} は必須です。")
        return text

    @staticmethod
    def _optional_text(params: dict[str, Any], key: str) -> str:
        return str(params.get(key) or "").strip()

    @staticmethod
    def _normalize_method(value: Any) -> str:
        method = str(value or "GET").strip().upper()
        if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
            raise ValueError(f"未対応の method です: {method}")
        return method

    @staticmethod
    def _parse_headers(value: Any) -> dict[str, str]:
        text = str(value or "").strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as error:
            raise ValueError(f"headers は JSON オブジェクトで指定してください。: {error}") from error
        if not isinstance(parsed, dict):
            raise ValueError("headers は JSON オブジェクトで指定してください。")
        return {str(key): str(val) for key, val in parsed.items()}

    def run_api(self, params: dict[str, Any]) -> dict[str, Any]:
        profile_name = self._required_text(params, "api_profile")
        profile = get_api_profile(profile_name)
        if not profile:
            raise ValueError(f"api_profile が見つかりません: {profile_name}")

        base_url = str(profile.get("base_url") or "").strip()
        if not base_url:
            raise ValueError(f"api_profile.base_url が未設定です: {profile_name}")

        path = self._optional_text(params, "path")
        method = self._normalize_method(params.get("method"))
        headers = self._parse_headers(params.get("headers"))
        body_text = str(params.get("body") or "")
        timeout_sec = int(profile.get("timeout_sec") or 30)
        certificate = profile.get("certificate") or None

        target_url = urljoin(base_url.rstrip("/") + "/", path.lstrip("/")) if path else base_url
        if not is_web_target_allowed(target_url):
            raise ValueError(f"Web allowlist に未登録のため API 実行できません: {target_url}")

        if certificate:
            self.log_execution(
                "api_profile に certificate 設定がありますが、Windows 証明書ストア経由の client cert 解決は未実装のため未適用です。",
                level="warning",
            )

        request_data = body_text.encode("utf-8") if body_text and method in {"POST", "PUT", "PATCH", "DELETE"} else None
        request = Request(target_url, data=request_data, method=method)
        for key, value in headers.items():
            request.add_header(key, value)
        if request_data is not None and "Content-Type" not in headers:
            request.add_header("Content-Type", "application/json; charset=utf-8")

        self.log_execution(f"API 実行開始: {method} {target_url}")
        with urlopen(request, timeout=timeout_sec) as response:
            response_text = response.read().decode("utf-8", errors="replace")
            response_headers = dict(response.headers.items())
            status_code = int(getattr(response, "status", 200))

        parsed_json = None
        content_type = str(response_headers.get("Content-Type") or "")
        if "json" in content_type.lower():
            try:
                parsed_json = json.loads(response_text)
            except json.JSONDecodeError:
                parsed_json = None

        self.log_execution(f"API 実行完了: {status_code} {target_url}")
        return {
            "url": target_url,
            "method": method,
            "status_code": status_code,
            "headers": response_headers,
            "body_text": response_text,
            "body_json": parsed_json,
            "api_profile": profile_name,
        }
