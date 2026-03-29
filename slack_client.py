from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional
import re
import time

from playwright.sync_api import (
    Browser,
    BrowserContext,
    Locator,
    Page,
    Playwright,
    sync_playwright,
)


# =========================
# Exceptions
# =========================
class SlackClientError(Exception):
    """Base exception for Slack client errors."""


class LoginTimeoutError(SlackClientError):
    """Raised when login did not complete within the timeout."""


class ChannelOpenError(SlackClientError):
    """Raised when a channel could not be opened."""


class MessagePostError(SlackClientError):
    """Raised when a message could not be posted."""


# =========================
# Enum
# =========================
class PostMode(str, Enum):
    SEND = "send"
    DRAFT = "draft"
    SCHEDULE = "schedule"


# =========================
# Result Models
# =========================
@dataclass
class LaunchResult:
    headless: bool
    slack_url: str
    storage_state_path: Optional[str]


@dataclass
class LoginResult:
    logged_in: bool
    waited_seconds: float
    storage_state_saved: bool


@dataclass
class ChannelResult:
    channel_name: Optional[str]
    channel_url: str


@dataclass
class PostResult:
    mode: str
    channel_name: Optional[str]
    channel_url: str
    text: str
    sent_at: Optional[datetime]
    scheduled_for: Optional[datetime]


# =========================
# Client
# =========================
class SlackClient:
    """
    Slack Web automation client using Playwright.

    Notes:
    - This targets Slack Web UI, not Slack API.
    - UI selectors can break when Slack changes its DOM.
    - channel_name navigation and scheduled send are implemented as best effort.
    """

    def __init__(self) -> None:
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._storage_state_path: Optional[str] = None
        self._slack_url: str = "https://app.slack.com/"
        self._headless: bool = False

    # =========================
    # Public
    # =========================
    def launch(
        self,
        slack_url: str = "https://app.slack.com/",
        *,
        headless: bool = False,
        user_data_dir: str = "chrome-profile",
    ) -> LaunchResult:

        if self._context is not None:
            raise SlackClientError("Browser is already launched.")

        self._playwright = sync_playwright().start()
        playwright = self._require_playwright()

        # ここがポイント
        self._context = playwright.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,   # ← プロファイル保存
            channel="chrome",              # ← 既存Chrome使用
            headless=headless
        )

        context = self._require_context()

        # ページ取得（既に1つ開いてる）
        pages = context.pages
        if pages:
            self._page = pages[0]
        else:
            self._page = context.new_page()

        page = self._require_page()
        page.goto(slack_url)

        return LaunchResult(
            headless=headless,
            slack_url=slack_url,
            storage_state_path=None
        )
    def wait_for_login(
        self,
        *,
        timeout_sec: int = 300,
        save_storage_state: bool = True,
        storage_state_path: Optional[str] = None,
    ) -> LoginResult:
        page = self._require_page()
        context = self._require_context()

        save_path = storage_state_path or self._storage_state_path
        start = time.monotonic()

        while True:
            if self._is_logged_in():
                saved = False
                if save_storage_state and save_path:
                    Path(save_path).parent.mkdir(parents=True, exist_ok=True)
                    context.storage_state(path=save_path)
                    saved = True

                return LoginResult(
                    logged_in=True,
                    waited_seconds=time.monotonic() - start,
                    storage_state_saved=saved,
                )

            if time.monotonic() - start >= timeout_sec:
                raise LoginTimeoutError(
                    f"Slack login was not completed within {timeout_sec} seconds."
                )

            page.wait_for_timeout(1000)

    def open_channel(
        self,
        *,
        channel_url: Optional[str] = None,
        channel_name: Optional[str] = None,
        timeout_sec: int = 30,
    ) -> ChannelResult:
        page = self._require_page()

        if not channel_url and not channel_name:
            raise ValueError("Either channel_url or channel_name must be provided.")

        if channel_url:
            try:
                page.goto(
                    channel_url,
                    wait_until="domcontentloaded",
                    timeout=timeout_sec * 1000,
                )
                self._wait_until_ready(timeout_sec=timeout_sec)
            except Exception as exc:
                raise ChannelOpenError(
                    f"Failed to open channel URL: {channel_url}"
                ) from exc

            return ChannelResult(
                channel_name=self._get_current_channel(),
                channel_url=page.url,
            )

        channel_name_value = channel_name
        if channel_name_value is None:
            raise ValueError("channel_name must not be None.")

        try:
            self._open_channel_by_name(
                channel_name=channel_name_value,
                timeout_sec=timeout_sec,
            )
            self._wait_until_ready(timeout_sec=timeout_sec)
        except Exception as exc:
            raise ChannelOpenError(
                f"Failed to open channel by name: {channel_name_value}"
            ) from exc

        return ChannelResult(
            channel_name=self._get_current_channel(),
            channel_url=page.url,
        )

    def post_message(
        self,
        text: str,
        *,
        mode: PostMode = PostMode.SEND,
        scheduled_for: Optional[datetime] = None,
        timeout_sec: int = 30,
    ) -> PostResult:
        page = self._require_page()

        if not text.strip():
            raise ValueError("text must not be empty.")

        if mode == PostMode.SCHEDULE and scheduled_for is None:
            raise ValueError("scheduled_for is required when mode='schedule'.")

        if mode != PostMode.SCHEDULE and scheduled_for is not None:
            raise ValueError("scheduled_for can only be used when mode='schedule'.")

        self._wait_until_ready(timeout_sec=timeout_sec)
        self._focus_message_input(timeout_sec=timeout_sec)
        self._clear_message_input(timeout_sec=timeout_sec)
        self._fill_message_input(text)

        sent_at: Optional[datetime] = None

        if mode == PostMode.SEND:
            self._send_message(timeout_sec=timeout_sec)
            sent_at = datetime.now()
        elif mode == PostMode.DRAFT:
            pass
        elif mode == PostMode.SCHEDULE:
            schedule_value = scheduled_for
            if schedule_value is None:
                raise ValueError("scheduled_for is required for scheduled messages.")
            self._schedule_message(
                scheduled_for=schedule_value,
                timeout_sec=timeout_sec,
            )
        else:
            raise MessagePostError(f"Unsupported mode: {mode}")

        return PostResult(
            mode=mode.value,
            channel_name=self._get_current_channel(),
            channel_url=page.url,
            text=text,
            sent_at=sent_at,
            scheduled_for=scheduled_for,
        )

    def close(self) -> None:
        if self._context is not None:
            self._context.close()
            self._context = None

        if self._browser is not None:
            self._browser.close()
            self._browser = None

        if self._playwright is not None:
            self._playwright.stop()
            self._playwright = None

        self._page = None

    # =========================
    # Private - require helpers
    # =========================
    def _require_playwright(self) -> Playwright:
        playwright = self._playwright
        if playwright is None:
            raise SlackClientError("Playwright is not initialized.")
        return playwright

    def _require_browser(self) -> Browser:
        browser = self._browser
        if browser is None:
            raise SlackClientError("Browser is not initialized.")
        return browser

    def _require_context(self) -> BrowserContext:
        context = self._context
        if context is None:
            raise SlackClientError("Browser context is not initialized.")
        return context

    def _require_page(self) -> Page:
        page = self._page
        if page is None:
            raise SlackClientError("Browser page is not initialized.")
        return page

    # =========================
    # Private - common helpers
    # =========================
    def _is_logged_in(self) -> bool:
        page = self._require_page()

        selectors = [
            '[data-qa="message_input"]',
            '[data-qa="channel_sidebar_name"]',
            '[data-qa="virtual-list-item"]',
            '[aria-label*="Message" i]',
        ]

        for selector in selectors:
            try:
                if page.locator(selector).first.is_visible(timeout=500):
                    return True
            except Exception:
                continue

        return "app.slack.com/client/" in page.url.lower()

    def _wait_until_ready(self, *, timeout_sec: int = 30) -> None:
        page = self._require_page()
        deadline = time.monotonic() + timeout_sec

        while time.monotonic() < deadline:
            if self._locate_message_input() is not None:
                return
            page.wait_for_timeout(500)

        raise MessagePostError("Message input did not become ready in time.")

    def _locate_message_input(self) -> Optional[Locator]:
        page = self._require_page()

        candidate_selectors = [
            '[data-qa="message_input"]',
            '[role="textbox"]',
            '[contenteditable="true"]',
            'div[aria-label*="message" i]',
        ]

        for selector in candidate_selectors:
            try:
                locator = page.locator(selector).first
                if locator.count() > 0 and locator.is_visible():
                    return locator
            except Exception:
                continue

        return None

    def _focus_message_input(self, *, timeout_sec: int = 30) -> None:
        locator = self._locate_message_input()
        if locator is None:
            raise MessagePostError("Could not locate the Slack message input.")

        try:
            locator.click(timeout=timeout_sec * 1000)
        except Exception as exc:
            raise MessagePostError(
                "Failed to focus the Slack message input."
            ) from exc

    def _clear_message_input(self, *, timeout_sec: int = 30) -> None:
        page = self._require_page()
        self._focus_message_input(timeout_sec=timeout_sec)
        page.keyboard.press("Control+A")
        page.keyboard.press("Backspace")

    def _fill_message_input(self, text: str) -> None:
        page = self._require_page()
        page.keyboard.insert_text(text)

    def _send_message(self, *, timeout_sec: int = 30) -> None:
        page = self._require_page()

        try:
            page.keyboard.press("Enter")
            page.wait_for_timeout(700)
        except Exception as exc:
            raise MessagePostError("Failed to send the Slack message.") from exc

    # =========================
    # Private - channel helpers
    # =========================
    def _open_channel_by_name(self, *, channel_name: str, timeout_sec: int = 30) -> None:
        page = self._require_page()
        normalized = channel_name.strip()
        if not normalized:
            raise ValueError("channel_name must not be empty.")

        try:
            page.keyboard.press("Control+K")
        except Exception:
            try:
                page.keyboard.press("Meta+K")
            except Exception as exc:
                raise ChannelOpenError(
                    "Failed to open Slack quick switcher."
                ) from exc

        search_box = self._wait_for_any_locator(
            [
                '[data-qa="quick_switcher_input"]',
                'input[placeholder*="Jump to" i]',
                'input[aria-label*="jump to" i]',
                'input[type="text"]',
            ],
            timeout_sec=timeout_sec,
            error_message="Quick switcher input did not appear.",
        )

        search_box.click()
        search_box.fill("")
        page.keyboard.insert_text(normalized)
        page.wait_for_timeout(1000)

        if self._click_channel_search_result(
            channel_name=normalized,
            timeout_sec=timeout_sec,
        ):
            return

        page.keyboard.press("Enter")
        page.wait_for_timeout(1500)

        opened = self._get_current_channel() or ""
        if self._normalize_channel_name(opened) == self._normalize_channel_name(normalized):
            return

        if normalized.lower() in page.url.lower():
            return

        raise ChannelOpenError(
            f"Channel search completed, but the opened channel did not match '{channel_name}'."
        )

    def _click_channel_search_result(self, *, channel_name: str, timeout_sec: int = 30) -> bool:
        page = self._require_page()
        normalized_target = self._normalize_channel_name(channel_name)
        deadline = time.monotonic() + timeout_sec

        while time.monotonic() < deadline:
            try:
                candidates = page.locator(
                    '[role="option"], [data-qa*="quick_switcher"], [data-qa*="search_result"]'
                )
                count = min(candidates.count(), 20)

                for idx in range(count):
                    item = candidates.nth(idx)
                    try:
                        if not item.is_visible():
                            continue
                        text = item.inner_text().strip()
                    except Exception:
                        continue

                    normalized_text = self._normalize_channel_name(text)
                    if normalized_target and normalized_target in normalized_text:
                        item.click()
                        page.wait_for_timeout(1500)
                        return True
            except Exception:
                pass

            page.wait_for_timeout(300)

        return False

    def _normalize_channel_name(self, value: str) -> str:
        text = value.strip().lower()
        text = text.replace("#", "")
        text = re.sub(r"\s+", " ", text)
        return text

    def _get_current_channel(self) -> Optional[str]:
        page = self._require_page()

        candidate_selectors = [
            '[data-qa="channel_name"]',
            '[data-qa="channel_header_title"]',
            'h1',
        ]

        for selector in candidate_selectors:
            try:
                locator = page.locator(selector).first
                if locator.count() > 0 and locator.is_visible():
                    text = locator.inner_text().strip()
                    if text:
                        return text
            except Exception:
                continue

        return None

    # =========================
    # Private - schedule helpers
    # =========================
    def _schedule_message(self, *, scheduled_for: datetime, timeout_sec: int = 30) -> None:
        if scheduled_for <= datetime.now():
            raise ValueError("scheduled_for must be in the future.")

        self._focus_message_input(timeout_sec=timeout_sec)

        schedule_button = self._find_first_visible_locator(
            [
                '[data-qa="schedule_message_toggle"]',
                '[data-qa="schedule_message_button"]',
                'button[aria-label*="schedule" i]',
                'button[aria-label*="later" i]',
                'button:has-text("Schedule")',
                'button:has-text("Later")',
            ]
        )

        if schedule_button is None:
            raise MessagePostError(
                "Could not locate the schedule-send button. "
                "This workspace UI may use different selectors."
            )

        page = self._require_page()
        schedule_button.click(timeout=timeout_sec * 1000)
        page.wait_for_timeout(1000)

        self._choose_custom_schedule_option(timeout_sec=timeout_sec)
        self._fill_schedule_datetime(
            scheduled_for=scheduled_for,
            timeout_sec=timeout_sec,
        )
        self._confirm_schedule(timeout_sec=timeout_sec)

    def _choose_custom_schedule_option(self, *, timeout_sec: int = 30) -> None:
        custom_option = self._find_first_visible_locator(
            [
                '[role="menuitem"]:has-text("Custom")',
                '[role="option"]:has-text("Custom")',
                'button:has-text("Custom")',
                'button:has-text("Pick date")',
                'button:has-text("Date and time")',
                'button:has-text("日時")',
                'button:has-text("カスタム")',
            ]
        )

        if custom_option is not None:
            custom_option.click(timeout=timeout_sec * 1000)
            page = self._require_page()
            page.wait_for_timeout(800)

    def _fill_schedule_datetime(self, *, scheduled_for: datetime, timeout_sec: int = 30) -> None:
        page = self._require_page()
        date_text = scheduled_for.strftime("%Y-%m-%d")
        time_text = scheduled_for.strftime("%H:%M")
        deadline = time.monotonic() + timeout_sec

        date_filled = False
        time_filled = False

        while time.monotonic() < deadline and (not date_filled or not time_filled):
            if not date_filled:
                date_locator = self._find_first_visible_locator(
                    [
                        'input[type="date"]',
                        'input[aria-label*="date" i]',
                        'input[placeholder*="date" i]',
                    ]
                )
                if date_locator is not None:
                    try:
                        date_locator.click()
                        date_locator.fill(date_text)
                        date_filled = True
                    except Exception:
                        pass

            if not time_filled:
                time_locator = self._find_first_visible_locator(
                    [
                        'input[type="time"]',
                        'input[aria-label*="time" i]',
                        'input[placeholder*="time" i]',
                    ]
                )
                if time_locator is not None:
                    try:
                        time_locator.click()
                        time_locator.fill(time_text)
                        time_filled = True
                    except Exception:
                        pass

            if date_filled and time_filled:
                break

            page.wait_for_timeout(300)

        if not date_filled or not time_filled:
            raise MessagePostError(
                "Could not fill schedule date/time inputs. "
                "The schedule dialog may use a different UI in this workspace."
            )

    def _confirm_schedule(self, *, timeout_sec: int = 30) -> None:
        page = self._require_page()

        confirm_button = self._wait_for_any_locator(
            [
                'button:has-text("Schedule message")',
                'button:has-text("Schedule")',
                'button:has-text("Send later")',
                'button:has-text("送信予約")',
                'button:has-text("予約送信")',
            ],
            timeout_sec=timeout_sec,
            error_message="Could not locate the final schedule confirmation button.",
        )

        try:
            confirm_button.click(timeout=timeout_sec * 1000)
            page.wait_for_timeout(1000)
        except Exception as exc:
            raise MessagePostError("Failed to confirm scheduled message.") from exc

    # =========================
    # Private - locator helpers
    # =========================
    def _wait_for_any_locator(
        self,
        selectors: list[str],
        *,
        timeout_sec: int,
        error_message: str,
    ) -> Locator:
        page = self._require_page()
        deadline = time.monotonic() + timeout_sec

        while time.monotonic() < deadline:
            locator = self._find_first_visible_locator(selectors)
            if locator is not None:
                return locator
            page.wait_for_timeout(250)

        raise SlackClientError(error_message)

    def _find_first_visible_locator(self, selectors: list[str]) -> Optional[Locator]:
        page = self._require_page()

        for selector in selectors:
            try:
                locator = page.locator(selector).first
                if locator.count() > 0 and locator.is_visible():
                    return locator
            except Exception:
                continue

        return None


# =========================
# Example
# =========================
if __name__ == "__main__":
    client = SlackClient()

    try:
        client.launch(
            headless=False,
            # storage_state_path="state.json",
        )
        client.wait_for_login(timeout_sec=300, save_storage_state=True)

        # URL指定で開く
        # client.open_channel(channel_url="https://app.slack.com/client/TXXXXXXX/CXXXXXXX")

        # チャンネル名で開く
        # client.open_channel(channel_name="general")

        # すぐ送信
        # result = client.post_message("テスト送信", mode=PostMode.SEND)

        # 下書きだけ残す
        # result = client.post_message("下書きメッセージ", mode=PostMode.DRAFT)

        # 予約送信
        # result = client.post_message(
        #     "予約メッセージ",
        #     mode=PostMode.SCHEDULE,
        #     scheduled_for=datetime(2026, 3, 28, 9, 0),
        # )

        print("SlackClient is ready.")
    finally:
        client.close()