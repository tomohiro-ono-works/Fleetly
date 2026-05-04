(function () {
  const NOT_READY_TIMEOUT_MS = 10000;
  const RESPONSE_TIMEOUT_MS = 45000;
  const MAX_QUEUE_SIZE = 256;

  const state = {
    version: "1.0",
    ready: false,
    backend: null,
    pending: new Map(),
    queue: [],
  };

  function nextId() {
    return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function buildError(code, message) {
    return { code, message };
  }

  function settlePending(id, result) {
    const pending = state.pending.get(id);
    if (!pending) return;
    state.pending.delete(id);
    if (pending.timeoutId) {
      window.clearTimeout(pending.timeoutId);
    }
    if (result && result.error) {
      pending.reject(result.error);
      return;
    }
    pending.resolve(result ? result.payload : undefined);
  }

  function removeQueuedById(id) {
    const idx = state.queue.findIndex((item) => item.id === id);
    if (idx >= 0) state.queue.splice(idx, 1);
  }

  function rejectPending(id, error) {
    const pending = state.pending.get(id);
    if (!pending) return;
    state.pending.delete(id);
    if (pending.timeoutId) {
      window.clearTimeout(pending.timeoutId);
    }
    pending.reject(error);
  }

  function sendEnvelope(item) {
    if (!state.backend || typeof state.backend.postMessage !== "function") {
      rejectPending(item.id, buildError("E_NOT_READY", "ネイティブブリッジが初期化されていません。"));
      return;
    }
    try {
      state.backend.postMessage(JSON.stringify(item.envelope));
    } catch (err) {
      rejectPending(item.id, buildError("E_SEND_FAILED", String(err?.message || err || "送信に失敗しました。")));
    }
  }

  function flushQueue() {
    if (!state.ready || !state.backend) return;
    while (state.queue.length > 0) {
      const item = state.queue.shift();
      if (!state.pending.has(item.id)) continue;
      sendEnvelope(item);
    }
  }

  function handleIncoming(rawText) {
    let message = null;
    try {
      message = JSON.parse(String(rawText || ""));
    } catch (_) {
      return;
    }
    if (!message) return;
    if (message.kind === "res") {
      settlePending(message.id, message);
      return;
    }
    if (message.kind === "evt") {
      window.dispatchEvent(new CustomEvent("ziz:evt", { detail: message }));
    }
  }

  function createBridgeApi() {
    return {
      available() {
        return !!state.ready && !!state.backend;
      },
      call(type, payload = {}) {
        const id = nextId();
        const envelope = {
          v: state.version,
          kind: "cmd",
          type,
          id,
          ts: new Date().toISOString(),
          payload,
        };
        return new Promise((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            removeQueuedById(id);
            rejectPending(
              id,
              buildError(
                state.ready ? "E_RESPONSE_TIMEOUT" : "E_NOT_READY_TIMEOUT",
                state.ready
                  ? "ネイティブ応答がタイムアウトしました。"
                  : "ネイティブブリッジの初期化待機がタイムアウトしました。"
              )
            );
          }, state.ready ? RESPONSE_TIMEOUT_MS : NOT_READY_TIMEOUT_MS);

          state.pending.set(id, { resolve, reject, timeoutId });
          const item = { id, envelope };

          if (state.ready && state.backend) {
            sendEnvelope(item);
            return;
          }

          state.queue.push(item);
          if (state.queue.length > MAX_QUEUE_SIZE) {
            const dropped = state.queue.shift();
            if (dropped) {
              rejectPending(dropped.id, buildError("E_QUEUE_OVERFLOW", "起動待機キューが上限を超えました。"));
            }
          }
        });
      },
    };
  }

  function installBridge(channel) {
    const backend = channel?.objects?.backendBridge || null;
    if (!backend || typeof backend.postMessage !== "function") return;
    state.backend = backend;
    if (backend.messageToFrontend && typeof backend.messageToFrontend.connect === "function") {
      backend.messageToFrontend.connect(handleIncoming);
    }
    state.ready = true;
    flushQueue();
    window.dispatchEvent(new CustomEvent("ziz:bridge-ready"));
  }

  function loadQtWebChannel() {
    if (!(window.qt && window.qt.webChannelTransport)) return;
    if (window.QWebChannel) {
      new window.QWebChannel(window.qt.webChannelTransport, installBridge);
      return;
    }
    const script = document.createElement("script");
    script.src = "qrc:///qtwebchannel/qwebchannel.js";
    script.onload = function () {
      if (window.QWebChannel && window.qt && window.qt.webChannelTransport) {
        new window.QWebChannel(window.qt.webChannelTransport, installBridge);
      }
    };
    document.head.appendChild(script);
  }

  const bridgeApi = createBridgeApi();
  window.zizBridge = bridgeApi;
  const packages = window.zizPackages = window.zizPackages || {};
  const core = packages.core = packages.core || {};
  core.bridge = bridgeApi;
  loadQtWebChannel();
})();
