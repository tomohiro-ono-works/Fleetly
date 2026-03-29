import os
import re
import tempfile
import datetime
from typing import Optional, List, Dict, Any

import pandas as pd
import win32com.client

from connectors.base_connector import BaseConnector

OL_FOLDER_INBOX = 6
DEFAULT_ALLOWED_EXTENSIONS = {
    ".xlsx", ".xls", ".csv", ".pdf", ".txt",
    ".docx", ".pptx", ".png", ".jpg", ".jpeg",
}


def _get_namespace():
    outlook = win32com.client.Dispatch("Outlook.Application")
    return outlook.GetNamespace("MAPI")


def _get_outlook_application():
    return win32com.client.Dispatch("Outlook.Application")


def _safe_name(text: str, max_len: int = 80) -> str:
    text = str(text or "").strip()
    text = re.sub(r'[\\/:*?"<>|]', "_", text)
    text = re.sub(r"\s+", " ", text)
    if not text:
        text = "no_subject"
    return text[:max_len]


def _normalize_allowed_extensions(value: Any) -> set[str]:
    if value is None or value == "":
        return set(DEFAULT_ALLOWED_EXTENSIONS)

    if isinstance(value, str):
        raw_items = [item.strip() for item in value.split(",")]
    elif isinstance(value, (list, tuple, set)):
        raw_items = [str(item).strip() for item in value]
    else:
        raise ValueError("allowed_extensions はカンマ区切り文字列または配列で指定してください。")

    normalized = set()
    for item in raw_items:
        if not item:
            continue
        normalized.add(item.lower() if item.startswith(".") else f".{item.lower()}")
    return normalized or set(DEFAULT_ALLOWED_EXTENSIONS)


def _is_allowed_attachment(file_name: str, allowed_extensions: set[str]) -> bool:
    _, ext = os.path.splitext(str(file_name or ""))
    return ext.lower() in allowed_extensions


def _build_restrict(
    has_attachments: Optional[bool] = None,
    received: Optional[str] = None,
) -> Optional[str]:
    conditions = []

    if has_attachments is True:
        conditions.append("[HasAttachment] = True")
    elif has_attachments is False:
        conditions.append("[HasAttachment] = False")

    if received:
        now = datetime.datetime.now()

        if received == "today":
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif received == "yesterday":
            start = (now - datetime.timedelta(days=1)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
        else:
            start = None

        if start:
            dt_str = start.strftime("%Y/%m/%d %H:%M")
            conditions.append(f"[ReceivedTime] >= '{dt_str}'")

    return " AND ".join(conditions) if conditions else None


def _match_mail(
    item,
    sender: Optional[str] = None,
    subject: Optional[str] = None,
) -> bool:
    sender_name = str(getattr(item, "SenderName", "") or "")
    subject_text = str(getattr(item, "Subject", "") or "")

    if sender and sender.lower() not in sender_name.lower():
        return False

    if subject and subject.lower() not in subject_text.lower():
        return False

    return True


def _list_allowed_attachment_names(item, allowed_extensions: set[str]) -> List[str]:
    attachment_count = getattr(item.Attachments, "Count", 0)
    if attachment_count == 0:
        return []

    return [
        str(item.Attachments.Item(j).FileName)
        for j in range(1, attachment_count + 1)
        if _is_allowed_attachment(item.Attachments.Item(j).FileName, allowed_extensions)
    ]


def _search_mail_items(
    limit: int = 10,
    sender: Optional[str] = None,
    subject: Optional[str] = None,
    has_attachments: Optional[bool] = True,
    received: Optional[str] = None,
) -> List[Any]:
    namespace = _get_namespace()
    inbox = namespace.GetDefaultFolder(OL_FOLDER_INBOX)

    items = inbox.Items
    items.Sort("[ReceivedTime]", True)

    restrict_str = _build_restrict(
        has_attachments=has_attachments,
        received=received,
    )
    if restrict_str:
        items = items.Restrict(restrict_str)

    matched_items: List[Any] = []
    count = items.Count
    for i in range(1, count + 1):
        item = items.Item(i)

        if getattr(item, "MessageClass", "") != "IPM.Note":
            continue

        if not _match_mail(item, sender=sender, subject=subject):
            continue

        matched_items.append(item)
        if len(matched_items) >= limit:
            break

    return matched_items


def _save_allowed_attachments(
    item,
    base_temp_dir: str,
    allowed_extensions: set[str],
) -> List[str]:
    attachment_paths: List[str] = []
    attachment_count = getattr(item.Attachments, "Count", 0)
    if attachment_count == 0:
        return attachment_paths

    subject = _safe_name(getattr(item, "Subject", ""), max_len=120)
    os.makedirs(base_temp_dir, exist_ok=True)

    for j in range(1, attachment_count + 1):
        att = item.Attachments.Item(j)
        original_file_name = str(getattr(att, "FileName", f"attachment_{j}") or f"attachment_{j}")
        if not _is_allowed_attachment(original_file_name, allowed_extensions):
            continue

        file_name = _safe_name(f"{subject}.{original_file_name}", max_len=240)
        save_path = os.path.join(base_temp_dir, file_name)
        if os.path.exists(save_path):
            base, ext = os.path.splitext(save_path)
            k = 1
            while True:
                candidate = f"{base}_{k}{ext}"
                if not os.path.exists(candidate):
                    save_path = candidate
                    break
                k += 1

        att.SaveAsFile(save_path)
        attachment_paths.append(save_path)

    return attachment_paths


def _find_mail_by_entry_id(entry_id: str):
    if not entry_id:
        raise ValueError("entry_id は必須です。")
    namespace = _get_namespace()
    try:
        return namespace.GetItemFromID(entry_id)
    except Exception as exc:
        raise FileNotFoundError(f"指定されたメールが見つかりません: {entry_id}") from exc


def search_mail_to_df(
    limit: int = 10,
    sender: Optional[str] = None,
    subject: Optional[str] = None,
    has_attachments: Optional[bool] = True,
    received: Optional[str] = None,
    allowed_extensions: Optional[Any] = None,
) -> pd.DataFrame:
    """
    Outlook受信トレイを検索し、DataFrameで返す。
    attachments列は配列で持つ。
    添付ファイルは保存せず、許可拡張子に一致した添付ファイル名だけを返す。

    Args:
        limit: 最大取得件数
        sender: 送信者名の部分一致
        subject: 件名の部分一致
        has_attachments: 添付有無
        received: "today" / "yesterday"
        allowed_extensions: 許可する拡張子（例: ".xlsx,.pdf"）

    Returns:
        pandas.DataFrame
        columns:
            - entry_id
            - received_time
            - subject
            - sender
            - attachments  # list[str]
            - attachment_count
    """
    normalized_allowed_extensions = _normalize_allowed_extensions(allowed_extensions)
    matched_items = _search_mail_items(
        limit=limit,
        sender=sender,
        subject=subject,
        has_attachments=has_attachments,
        received=received,
    )

    rows: List[Dict[str, Any]] = []
    for item in matched_items:
        attachments = _list_allowed_attachment_names(item, normalized_allowed_extensions)

        rows.append(
            {
                "entry_id": str(getattr(item, "EntryID", "") or ""),
                "received_time": str(getattr(item, "ReceivedTime", "") or ""),
                "subject": str(getattr(item, "Subject", "") or ""),
                "sender": str(getattr(item, "SenderName", "") or ""),
                "attachments": attachments,
                "attachment_count": len(attachments),
            }
        )

    return pd.DataFrame(rows)


class OutlookConnector(BaseConnector):
    @staticmethod
    def _as_bool(value: Any, default: bool = False) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if action in {"search_mail", "search_mail_to_df"}:
            has_attachments = self._parse_optional_bool(params.get("has_attachments"))
            return self.search_mail(
                limit=int(params.get("limit", 10)),
                sender=self._normalize_optional_text(params.get("sender")),
                subject=self._normalize_optional_text(params.get("subject")),
                has_attachments=True if has_attachments is None else has_attachments,
                received=self._normalize_optional_text(params.get("received")),
                allowed_extensions=params.get("allowed_extensions"),
            )
        if action == "send_mail":
            to = self._normalize_optional_text(params.get("to"))
            cc = self._normalize_optional_text(params.get("cc"))
            bcc = self._normalize_optional_text(params.get("bcc"))
            subject = self._normalize_optional_text(params.get("subject"))
            body = self._normalize_optional_text(params.get("body"))
            html_body = self._normalize_optional_text(params.get("html_body"))
            if not to:
                raise ValueError("to は必須です。")
            if not subject:
                raise ValueError("subject は必須です。")
            if body is None and html_body is None:
                raise ValueError("body または html_body のどちらかは必須です。")
            return self.send_mail(
                to=to,
                cc=cc,
                bcc=bcc,
                subject=subject,
                body=body,
                html_body=html_body,
            )
        if action == "download_attachments":
            entry_id = self._normalize_optional_text(params.get("entry_id"))
            output_dir = self.normalize_file_path(params.get("output_dir"))
            temp_subdir = str(params.get("temp_subdir", "outlook_attachments"))
            if entry_id:
                return self.download_attachments_by_entry_id(
                    entry_id=entry_id,
                    output_dir=output_dir,
                    temp_subdir=temp_subdir,
                    allowed_extensions=params.get("allowed_extensions"),
                )
            has_attachments = self._parse_optional_bool(params.get("has_attachments"))
            return self.download_attachments(
                limit=int(params.get("limit", 10)),
                sender=self._normalize_optional_text(params.get("sender")),
                subject=self._normalize_optional_text(params.get("subject")),
                has_attachments=True if has_attachments is None else has_attachments,
                received=self._normalize_optional_text(params.get("received")),
                output_dir=output_dir,
                temp_subdir=temp_subdir,
                allowed_extensions=params.get("allowed_extensions"),
            )
        raise ValueError(f"Unknown action: {action}")

    @staticmethod
    def _normalize_optional_text(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _parse_optional_bool(self, value: Any) -> Optional[bool]:
        if value is None or value == "":
            return None
        return self._as_bool(value)

    def search_mail(
        self,
        limit: int = 10,
        sender: Optional[str] = None,
        subject: Optional[str] = None,
        has_attachments: Optional[bool] = True,
        received: Optional[str] = None,
        allowed_extensions: Optional[Any] = None,
    ) -> pd.DataFrame:
        return search_mail_to_df(
            limit=limit,
            sender=sender,
            subject=subject,
            has_attachments=has_attachments,
            received=received,
            allowed_extensions=allowed_extensions,
        )

    def download_attachments(
        self,
        limit: int = 10,
        sender: Optional[str] = None,
        subject: Optional[str] = None,
        has_attachments: Optional[bool] = True,
        received: Optional[str] = None,
        output_dir: Optional[str] = None,
        temp_subdir: str = "outlook_attachments",
        allowed_extensions: Optional[Any] = None,
    ) -> pd.DataFrame:
        base_temp_dir = self._resolve_download_dir(output_dir=output_dir, temp_subdir=temp_subdir)
        normalized_allowed_extensions = _normalize_allowed_extensions(allowed_extensions)
        matched_items = _search_mail_items(
            limit=limit,
            sender=sender,
            subject=subject,
            has_attachments=has_attachments,
            received=received,
        )
        rows: List[Dict[str, Any]] = []
        for item in matched_items:
            saved_paths = _save_allowed_attachments(item, base_temp_dir, normalized_allowed_extensions)
            rows.append(
                {
                    "entry_id": str(getattr(item, "EntryID", "") or ""),
                    "subject": str(getattr(item, "Subject", "") or ""),
                    "saved_attachments": saved_paths,
                    "saved_count": len(saved_paths),
                }
            )
        return pd.DataFrame(rows)

    def download_attachments_by_entry_id(
        self,
        entry_id: str,
        output_dir: Optional[str] = None,
        temp_subdir: str = "outlook_attachments",
        allowed_extensions: Optional[Any] = None,
    ) -> pd.DataFrame:
        item = _find_mail_by_entry_id(entry_id)
        base_temp_dir = self._resolve_download_dir(output_dir=output_dir, temp_subdir=temp_subdir)
        normalized_allowed_extensions = _normalize_allowed_extensions(allowed_extensions)
        saved_paths = _save_allowed_attachments(item, base_temp_dir, normalized_allowed_extensions)
        return pd.DataFrame(
            [
                {
                    "entry_id": entry_id,
                    "subject": str(getattr(item, "Subject", "") or ""),
                    "saved_attachments": saved_paths,
                    "saved_count": len(saved_paths),
                }
            ]
        )

    def _resolve_download_dir(self, output_dir: Optional[str], temp_subdir: str) -> str:
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            return output_dir

        base_temp_dir = os.path.join(tempfile.gettempdir(), temp_subdir)
        os.makedirs(base_temp_dir, exist_ok=True)
        return base_temp_dir

    def send_mail(
        self,
        to: str,
        subject: str,
        body: Optional[str] = None,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        html_body: Optional[str] = None,
    ) -> str:
        outlook = _get_outlook_application()
        mail = outlook.CreateItem(0)
        mail.To = to
        if cc:
            mail.CC = cc
        if bcc:
            mail.BCC = bcc
        mail.Subject = subject
        if html_body is not None:
            mail.HTMLBody = html_body
        else:
            mail.Body = body or ""
        mail.Send()
        recipients = [f"to={to}"]
        if cc:
            recipients.append(f"cc={cc}")
        if bcc:
            recipients.append(f"bcc={bcc}")
        return f"メールを送信しました: {', '.join(recipients)}, subject={subject}"
