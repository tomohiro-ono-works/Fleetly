import logging

from PySide6.QtCore import QObject, Qt, QThread, Signal, Slot

from app.gui.bridge_contract import serialize_message


logger = logging.getLogger("ziz.bridge_events")


class BridgeMessageQueue(QObject):
    message_ready = Signal(str)
    _publish_requested = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._publish_requested.connect(
            self._publish_on_owner_thread,
            Qt.ConnectionType.QueuedConnection,
        )

    def publish(self, message):
        try:
            serialized = serialize_message(message)
        except Exception:
            logger.exception("bridge message serialization failed")
            return
        if QThread.currentThread() == self.thread():
            self.message_ready.emit(serialized)
            return
        self._publish_requested.emit(serialized)

    @Slot(str)
    def _publish_on_owner_thread(self, serialized):
        self.message_ready.emit(serialized)
