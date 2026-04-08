(function () {
  const state = {
    version: "1.0",
    ready: false,
    backend: null,
    pending: new Map(),
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
    if (result && result.error) {
      pending.reject(result.error);
      return;
    }
    pending.resolve(result ? result.payload : undefined);
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
        if (!state.ready || !state.backend) {
          return Promise.reject(buildError("E_NOT_READY", "ネイティブブリッジが初期化されていません。"));
        }
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
          state.pending.set(id, { resolve, reject });
          state.backend.postMessage(JSON.stringify(envelope));
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
