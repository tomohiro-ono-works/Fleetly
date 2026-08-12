import logging
import re
from datetime import datetime, timezone


STEP_PREFIX_PATTERN = re.compile(r"^\[([^\]]+)\]")


class RunLogHandler(logging.Handler):
    def __init__(self, run_service, run_id):
        super().__init__(level=logging.INFO)
        self._run_service = run_service
        self._run_id = run_id

    def emit(self, record):
        try:
            level = str(record.levelname or "INFO").upper()
            if level == "CRITICAL":
                level = "ERROR"
            message = record.getMessage()
            step_id = str(getattr(record, "step_id", "") or "").strip()
            if not step_id:
                match = STEP_PREFIX_PATTERN.match(message)
                step_id = match.group(1).strip() if match else ""
            connector_id = str(
                getattr(record, "connector_id", "") or ""
            ).strip()
            action_id = str(
                getattr(record, "action_id", "") or ""
            ).strip()
            category = str(
                getattr(record, "category", "") or ""
            ).strip()
            if not category:
                category = (
                    "connector"
                    if connector_id or action_id
                    else ("step" if step_id else "system")
                )
            self._run_service.append_run_log(
                run_id=self._run_id,
                ts=datetime.fromtimestamp(
                    record.created,
                    timezone.utc,
                ).isoformat(),
                level=level,
                category=category,
                message=message,
                step_id=step_id,
                connector_id=connector_id,
                action_id=action_id,
                iteration_no=getattr(record, "iteration_no", None),
                iteration_total=getattr(record, "iteration_total", None),
                detail=getattr(record, "detail", None),
            )
        except Exception:
            return
