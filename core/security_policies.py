from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

import yaml


BASE_DIR = Path(__file__).resolve().parents[1]


def load_security_policies(base_dir: str | Path | None = None):
    root = Path(base_dir).resolve() if base_dir else BASE_DIR
    policy_path = root / "config" / "security_policies.yml"
    if not policy_path.exists():
        return {
            "loaded": False,
            "path": str(policy_path),
            "version": 1,
            "apis": {"profiles": {}},
            "web": {"allowlist": []},
        }

    with policy_path.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}

    if not isinstance(raw, dict):
        raise ValueError("security_policies.yml は辞書形式である必要があります。")

    return {
        "loaded": True,
        "path": str(policy_path),
        "version": int(raw.get("version") or 1),
        "apis": _normalize_apis(raw.get("apis")),
        "web": _normalize_allowlist(raw.get("web")),
    }


def _normalize_apis(value):
    profiles = {}
    if isinstance(value, dict):
        raw_profiles = value.get("profiles")
        if isinstance(raw_profiles, dict):
            for name, item in raw_profiles.items():
                if not isinstance(item, dict):
                    continue
                profiles[str(name)] = {
                    "base_url": str(item.get("base_url") or ""),
                    "timeout_sec": int(item.get("timeout_sec") or 30),
                    "certificate": _normalize_certificate(item.get("certificate")),
                }
    return {"profiles": profiles}


def _normalize_certificate(value):
    if not isinstance(value, dict):
        return None
    provider = str(value.get("provider") or "").strip()
    if not provider:
        return None
    return {
        "provider": provider,
        "store_location": str(value.get("store_location") or ""),
        "store_name": str(value.get("store_name") or ""),
        "subject_contains": str(value.get("subject_contains") or ""),
    }


def _normalize_allowlist(value):
    allowlist = []
    if isinstance(value, dict):
        raw_items = value.get("allowlist")
        if isinstance(raw_items, list):
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                domain = str(item.get("domain") or "").strip().lower()
                if not domain:
                    continue
                prefixes = item.get("path_prefixes")
                if not isinstance(prefixes, list) or not prefixes:
                    prefixes = ["/"]
                allowlist.append({
                    "domain": domain,
                    "path_prefixes": [str(prefix or "/") for prefix in prefixes],
                })
    return {"allowlist": allowlist}


def get_api_profile(profile_name: str, base_dir: str | Path | None = None):
    policies = load_security_policies(base_dir=base_dir)
    profiles = policies.get("apis", {}).get("profiles", {})
    return profiles.get(str(profile_name or "").strip())


def is_web_target_allowed(url: str, base_dir: str | Path | None = None):
    policies = load_security_policies(base_dir=base_dir)
    allowlist = policies.get("web", {}).get("allowlist", [])
    parsed = urlparse(str(url or ""))
    domain = (parsed.hostname or "").lower()
    path = parsed.path or "/"
    for rule in allowlist:
        if domain != rule.get("domain"):
            continue
        for prefix in rule.get("path_prefixes", ["/"]):
            if path.startswith(prefix):
                return True
    return False


def is_rpa_target_allowed(url: str, base_dir: str | Path | None = None):
    return is_web_target_allowed(url, base_dir=base_dir)
