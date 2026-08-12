import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath, PureWindowsPath

from app.services.errors import ApplicationServiceError


logger = logging.getLogger("ziz.workspace_service")


class WorkspaceService:
    MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024
    READ_TEXT_EXTENSIONS = frozenset({".md", ".sql", ".py", ".json", ".zizd"})
    WRITE_TEXT_EXTENSIONS = frozenset({
        ".md",
        ".sql",
        ".py",
        ".yml",
        ".yaml",
        ".json",
        ".txt",
        ".ini",
        ".cfg",
        ".env",
        ".js",
        ".zizd",
    })

    def __init__(
        self,
        base_dir,
        *,
        config_root=None,
    ):
        self.base_dir = Path(base_dir).resolve()
        self.config_root = Path(config_root or (self.base_dir / "config")).resolve()
        self._workspace_root = None

    @property
    def workspace_root(self):
        return self._workspace_root

    @workspace_root.setter
    def workspace_root(self, value):
        if value is None or not str(value).strip():
            self._workspace_root = None
            return
        self._workspace_root = self._validate_root(value)

    def get_root(self):
        if self._workspace_root is None:
            default_root = (self.base_dir / "workflows").resolve()
            if default_root.exists() and default_root.is_dir():
                self._workspace_root = self._validate_root(default_root)
        return self._root_response()

    def set_root(self, root_path):
        text = str(root_path or "").strip()
        if not text:
            self._workspace_root = None
            return self._root_response()
        self._workspace_root = self._validate_root(text)
        return self._root_response()

    def select_root(self, selected_path):
        if not selected_path:
            return {
                "selected": False,
                "root_path": str(self._workspace_root or ""),
            }
        self._workspace_root = self._validate_root(selected_path)
        return {
            "selected": True,
            "root_path": str(self._workspace_root),
        }

    def list_entries(self, *, scope="root", rel_path=""):
        base, target, normalized_rel_path = self.resolve_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=True,
            expect_dir=True,
        )
        entries = []
        for child in target.iterdir():
            if child.is_symlink():
                logger.warning("[workspace] symlink entry was skipped")
                continue
            stat = child.stat()
            is_dir = child.is_dir()
            has_children = False
            if is_dir:
                try:
                    has_children = next(child.iterdir(), None) is not None
                except OSError:
                    has_children = False
            entries.append({
                "name": child.name,
                "rel_path": child.relative_to(base).as_posix(),
                "kind": "dir" if is_dir else "file",
                "has_children": bool(has_children),
                "size": int(stat.st_size) if not is_dir else 0,
                "mtime_ns": str(int(stat.st_mtime_ns)),
                "modified_at": self._to_iso_datetime(stat.st_mtime),
            })
        entries.sort(
            key=lambda item: (
                0 if item["kind"] == "dir" else 1,
                item["name"].lower(),
            )
        )
        return {
            "scope": self._normalize_scope(scope),
            "rel_path": normalized_rel_path,
            "entries": entries,
        }

    def stat(self, *, scope="root", rel_path):
        _, target, normalized_rel_path = self.resolve_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=True,
            expect_file=True,
        )
        stat = target.stat()
        return {
            "scope": self._normalize_scope(scope),
            "rel_path": normalized_rel_path,
            "file_name": target.name,
            "mtime_ns": str(int(stat.st_mtime_ns)),
            "size": int(stat.st_size),
            "exists": True,
        }

    def read_text(self, *, scope="root", rel_path):
        _, target, normalized_rel_path = self.resolve_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=True,
            expect_file=True,
        )
        if target.suffix.lower() not in self.READ_TEXT_EXTENSIONS:
            raise ValueError("対応していないファイル形式です。")
        stat = target.stat()
        if stat.st_size > self.MAX_TEXT_FILE_BYTES:
            raise ApplicationServiceError(
                "E_RESULT_TOO_LARGE",
                "テキストファイルのサイズが上限を超えています。",
            )
        content, encoding = self._read_text_with_fallback(target)
        return {
            "scope": self._normalize_scope(scope),
            "rel_path": normalized_rel_path,
            "file_name": target.name,
            "content": content,
            "encoding": encoding,
            "mtime_ns": str(int(stat.st_mtime_ns)),
            "size": int(stat.st_size),
        }

    def write_text(
        self,
        *,
        scope="root",
        rel_path,
        content,
        expected_mtime_ns=None,
        force=False,
    ):
        _, target, normalized_rel_path = self.resolve_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=False,
            for_write=True,
        )
        if target.exists() and target.is_dir():
            raise ValueError("保存先がフォルダです。")
        if not self._is_allowed_write_target(target):
            raise ValueError("この拡張子への保存は許可されていません。")
        if target.exists() and expected_mtime_ns is not None and not force:
            try:
                expected_value = int(expected_mtime_ns)
            except (TypeError, ValueError) as error:
                raise ValueError("expected_mtime_ns の形式が不正です。") from error
            if expected_value != int(target.stat().st_mtime_ns):
                raise ApplicationServiceError(
                    "E_CONFLICT",
                    "ファイルが外部で更新されています。",
                )
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8", newline="") as handle:
            handle.write(str(content or ""))
        stat = target.stat()
        return {
            "scope": self._normalize_scope(scope),
            "rel_path": normalized_rel_path,
            "file_name": target.name,
            "mtime_ns": str(int(stat.st_mtime_ns)),
            "size": int(stat.st_size),
            "saved": True,
        }

    def mkdir(self, *, scope="root", rel_path):
        _, target, normalized_rel_path = self.resolve_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=False,
            for_write=True,
        )
        if not normalized_rel_path:
            raise ValueError("作成先パスが未指定です。")
        if target.exists():
            if target.is_dir():
                raise ValueError("同名のフォルダが既に存在します。")
            raise ValueError("同名のファイルが存在します。")
        target.mkdir(parents=True, exist_ok=False)
        return {
            "scope": self._normalize_scope(scope),
            "rel_path": normalized_rel_path,
            "name": target.name,
            "created": True,
            "kind": "dir",
        }

    def delete(self, *, scope="root", rel_path, recursive=False):
        _, target, normalized_rel_path = self.resolve_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=True,
        )
        if not normalized_rel_path:
            raise ValueError("削除対象パスが未指定です。")
        if target.is_symlink():
            self._deny_access("delete target symlink is not allowed")
        if target.is_dir():
            if recursive is not True:
                raise ValueError("フォルダ削除では recursive: true が必須です。")
            shutil.rmtree(target)
            kind = "dir"
        elif target.is_file():
            target.unlink()
            kind = "file"
        else:
            raise ValueError("削除対象が不正です。")
        return {
            "scope": self._normalize_scope(scope),
            "rel_path": normalized_rel_path,
            "deleted": True,
            "kind": kind,
        }

    def resolve_path(
        self,
        *,
        scope,
        rel_path,
        require_exists,
        expect_dir=False,
        expect_file=False,
        for_write=False,
    ):
        base = self._resolve_base(scope)
        normalized_rel_path = self._normalize_relative_path(rel_path)
        raw_candidate = (
            base.joinpath(*PurePosixPath(normalized_rel_path).parts)
            if normalized_rel_path
            else base
        )
        candidate = raw_candidate.resolve(strict=False)
        if not self._is_relative_to(candidate, base):
            self._deny_access("path escapes allowed base")
        if self._path_has_symlink(base, raw_candidate):
            self._deny_access("symlink path is not allowed")
        if require_exists and not candidate.exists():
            raise FileNotFoundError("対象が見つかりません。")
        if expect_dir and candidate.exists() and not candidate.is_dir():
            raise ValueError("対象がフォルダではありません。")
        if expect_file and candidate.exists() and not candidate.is_file():
            raise ValueError("対象がファイルではありません。")
        if for_write and candidate.exists() and candidate.is_symlink():
            self._deny_access("write target symlink is not allowed")
        return base, candidate, normalized_rel_path

    def _root_response(self):
        return {
            "has_root": self._workspace_root is not None,
            "root_path": str(self._workspace_root or ""),
            "config_path": str(self.config_root),
        }

    def _validate_root(self, root_path):
        raw = Path(str(root_path))
        if raw.is_symlink():
            self._deny_access("workspace root symlink is not allowed")
        resolved = raw.resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise FileNotFoundError("フォルダが見つかりません。")
        return resolved

    def _resolve_base(self, scope):
        normalized = self._normalize_scope(scope)
        if normalized == "root":
            if self._workspace_root is None:
                raise ValueError("ワークスペースルートが未選択です。")
            return self._workspace_root
        return self.config_root

    def _normalize_scope(self, scope):
        normalized = str(scope or "root").strip()
        if normalized == "workspace":
            return "root"
        if normalized in {"root", "config"}:
            return normalized
        raise ValueError("scope が不正です。")

    def _normalize_relative_path(self, rel_path):
        text = str(rel_path or "").replace("\\", "/").strip()
        if "\x00" in text:
            raise ValueError("rel_path にNUL文字は指定できません。")
        if PurePosixPath(text).is_absolute() or PureWindowsPath(text).is_absolute():
            raise ValueError("rel_path は相対パスで指定してください。")
        path = PurePosixPath(text)
        if ".." in path.parts:
            raise ValueError("rel_path に親フォルダ参照は指定できません。")
        return "/".join(part for part in path.parts if part not in {"", "."})

    def _is_allowed_write_target(self, target):
        suffix = target.suffix.lower()
        return suffix in self.WRITE_TEXT_EXTENSIONS or target.name.lower() == ".env"

    def _path_has_symlink(self, base, target):
        if base.exists() and base.is_symlink():
            return True
        if target == base:
            return False
        try:
            relative = target.relative_to(base)
        except ValueError:
            return True
        cursor = base
        for part in relative.parts:
            cursor = cursor / part
            if cursor.exists() and cursor.is_symlink():
                return True
        return False

    def _is_relative_to(self, candidate, base):
        try:
            candidate.relative_to(base)
            return True
        except ValueError:
            return False

    def _deny_access(self, reason):
        logger.warning("[workspace] access denied: reason=%s", str(reason or ""))
        raise PermissionError("アクセスが拒否されました。")

    def _read_text_with_fallback(self, path):
        last_error = None
        for encoding in ("utf-8", "cp932", "shift_jis"):
            try:
                return path.read_text(encoding=encoding), encoding
            except UnicodeDecodeError as error:
                last_error = error
        if last_error:
            raise ValueError(
                "テキストを読み込めません。文字コードを確認してください。"
            )
        return path.read_text(encoding="utf-8", errors="replace"), "utf-8"

    def _to_iso_datetime(self, timestamp):
        return (
            datetime.fromtimestamp(float(timestamp), tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
