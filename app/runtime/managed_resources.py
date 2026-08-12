from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass


def _text(value):
    return str(value or "").strip()


@dataclass
class ManagedResource:
    resource_id: str
    kind: str
    value: object
    cleanup: object
    run_id: str
    doc_session_id: str
    step_id: str


class ManagedResourceRegistry:
    def __init__(self):
        self._lock = threading.RLock()
        self._resources = {}

    def register(
        self,
        *,
        kind,
        value,
        cleanup,
        run_id="",
        doc_session_id="",
        step_id="",
        resource_id="",
        replace_step=False,
    ):
        normalized_kind = _text(kind)
        if not normalized_kind:
            raise ValueError("kind は必須です。")
        if not callable(cleanup):
            raise ValueError("cleanup はcallableで指定してください。")
        normalized_id = _text(resource_id) or (
            f"{normalized_kind}_{uuid.uuid4().hex}"
        )
        normalized_doc = _text(doc_session_id)
        normalized_step = _text(step_id)
        if replace_step and normalized_doc and normalized_step:
            self.release_step(normalized_doc, normalized_step)
        item = ManagedResource(
            resource_id=normalized_id,
            kind=normalized_kind,
            value=value,
            cleanup=cleanup,
            run_id=_text(run_id),
            doc_session_id=normalized_doc,
            step_id=normalized_step,
        )
        with self._lock:
            if normalized_id in self._resources:
                raise ValueError(
                    f"managed resource idが重複しています: {normalized_id}"
                )
            self._resources[normalized_id] = item
        return normalized_id

    def get(self, resource_id):
        with self._lock:
            item = self._resources.get(_text(resource_id))
            return item.value if item is not None else None

    def contains(self, resource_id):
        with self._lock:
            return _text(resource_id) in self._resources

    def release(self, resource_id):
        with self._lock:
            item = self._resources.pop(_text(resource_id), None)
        if item is None:
            return False
        self._cleanup(item)
        return True

    def release_run(self, run_id):
        return self._release_matching(
            lambda item: item.run_id == _text(run_id)
        )

    def release_step(self, doc_session_id, step_id):
        normalized_doc = _text(doc_session_id)
        normalized_step = _text(step_id)
        return self._release_matching(
            lambda item: (
                item.doc_session_id == normalized_doc
                and item.step_id == normalized_step
            )
        )

    def release_document(self, doc_session_id):
        normalized_doc = _text(doc_session_id)
        return self._release_matching(
            lambda item: item.doc_session_id == normalized_doc
        )

    def release_all(self):
        return self._release_matching(lambda _item: True)

    def snapshot(self):
        with self._lock:
            return [
                {
                    "resource_id": item.resource_id,
                    "kind": item.kind,
                    "run_id": item.run_id,
                    "doc_session_id": item.doc_session_id,
                    "step_id": item.step_id,
                }
                for item in self._resources.values()
            ]

    def _release_matching(self, predicate):
        with self._lock:
            matching = [
                item
                for item in self._resources.values()
                if predicate(item)
            ]
            for item in matching:
                self._resources.pop(item.resource_id, None)
        for item in matching:
            self._cleanup(item)
        return len(matching)

    def _cleanup(self, item):
        try:
            item.cleanup(item.value)
        except Exception:
            return


managed_resource_registry = ManagedResourceRegistry()
