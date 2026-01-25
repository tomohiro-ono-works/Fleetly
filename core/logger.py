import logging
import os
from datetime import datetime
import asyncio

# ログをブラウザへ送るためのグローバルなキュー
log_queue = asyncio.Queue()

class WebSocketHandler(logging.Handler):
    """ログをキューに転送するカスタムハンドラ"""
    def emit(self, record):
        log_entry = self.format(record)
        # asyncioのイベントループにスレッドセーフでデータを投入
        try:
            loop = asyncio.get_running_loop()
            loop.call_soon_threadsafe(log_queue.put_nowait, log_entry)
        except RuntimeError:
            pass

def setup_logger():
    if not os.path.exists('logs'):
        os.makedirs('logs')
    
    logger = logging.getLogger("Fleetly")
    logger.setLevel(logging.INFO)
    logger.handlers = [] # 重複防止

    formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')

    # コンソール出力
    sh = logging.StreamHandler()
    sh.setFormatter(formatter)
    logger.addHandler(sh)

    # WebSocket用出力 (追加)
    wh = WebSocketHandler()
    wh.setFormatter(formatter)
    logger.addHandler(wh)

    return logger