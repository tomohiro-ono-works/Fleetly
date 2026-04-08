// modal_core.js
(function () {
  "use strict";

  function create(rootEl) {
    let isOpen = false;
    let lastActive = null;

    function open() {
      if (isOpen) return;
      lastActive = document.activeElement;

      rootEl.classList.add("is-open");
      rootEl.setAttribute("aria-hidden", "false");
      isOpen = true;
    }

    function close() {
      if (!isOpen) return;
      rootEl.classList.remove("is-open");
      rootEl.setAttribute("aria-hidden", "true");
      isOpen = false;

      if (lastActive && typeof lastActive.focus === "function") {
        lastActive.focus();
      }
    }

    // backdrop / close button
    rootEl.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.hasAttribute && t.hasAttribute("data-mdl-close")) close();
    });

    // ESC close
    document.addEventListener("keydown", (e) => {
      if (!isOpen) return;
      if (e.key === "Escape") close();
    });

    function q(sel) {
      const el = rootEl.querySelector(sel);
      if (!el) throw new Error(`Element not found in modal: ${sel}`);
      return el;
    }

    return { open, close, q, root: rootEl };
  }

  const modalCore = { create };
  window.ModalCore = modalCore;
})();
