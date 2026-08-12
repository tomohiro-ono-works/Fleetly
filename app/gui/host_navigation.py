from dataclasses import dataclass
from pathlib import Path

from app.gui.bridge_security import is_safe_external_url


ALLOW = "allow"
OPEN_EXTERNAL = "open_external"
BLOCK = "block"


def _is_within_path(path, base_dir):
    try:
        path.relative_to(base_dir)
        return True
    except ValueError:
        return False


@dataclass(frozen=True)
class TrustedNavigationPolicy:
    asset_root: Path
    entry_file: Path
    page_names: frozenset = frozenset({"home.html", "dataflow.html", "settings.html"})

    def __post_init__(self):
        object.__setattr__(self, "asset_root", Path(self.asset_root).resolve())
        object.__setattr__(self, "entry_file", Path(self.entry_file).resolve())
        if not _is_within_path(self.entry_file, self.asset_root):
            raise ValueError("entry fileはasset root配下で指定してください。")
        if self.entry_file.name not in self.page_names:
            raise ValueError("entry fileが許可済みpageではありません。")

    def classify(self, *, url_text, scheme, local_file="", is_main_frame):
        normalized_scheme = str(scheme or "").strip().lower()
        if normalized_scheme in {"http", "https"}:
            return OPEN_EXTERNAL if is_main_frame and is_safe_external_url(url_text) else BLOCK
        if normalized_scheme == "file":
            target = Path(str(local_file or "")).resolve()
            if not _is_within_path(target, self.asset_root):
                return BLOCK
            if is_main_frame:
                allowed_pages = {
                    (self.asset_root / page_name).resolve()
                    for page_name in self.page_names
                }
                if target not in allowed_pages:
                    return BLOCK
            return ALLOW
        if normalized_scheme == "qrc":
            if is_main_frame:
                return BLOCK
            return ALLOW if str(url_text or "").startswith("qrc:///qtwebchannel/") else BLOCK
        if normalized_scheme in {"data", "blob"}:
            return BLOCK if is_main_frame else ALLOW
        return BLOCK

    def allow_request(self, *, url_text, scheme, local_file=""):
        normalized_scheme = str(scheme or "").strip().lower()
        if normalized_scheme == "file":
            target = Path(str(local_file or "")).resolve()
            return _is_within_path(target, self.asset_root)
        if normalized_scheme == "qrc":
            return str(url_text or "").startswith("qrc:///qtwebchannel/")
        if normalized_scheme in {"data", "blob"}:
            return True
        return False
