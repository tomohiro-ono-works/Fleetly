(function (root) {
  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__uiShellModules = packages.__uiShellModules || {};
  const types = modules.shellTypes;

  function createLayoutController({ refs, initialLayout, onChange }) {
    const documentRef = refs.root.ownerDocument;
    const windowRef = documentRef.defaultView;
    let layout = types.normalizeLayout(initialLayout);
    let resizeState = null;
    let frameId = 0;
    let pendingPatch = null;

    function snapshot() {
      return { ...layout };
    }

    function apply() {
      const rootElement = refs.root;
      rootElement.classList.toggle("is-sidebar-visible", layout.sidebarVisible);
      rootElement.classList.toggle("is-right-panel-visible", layout.rightPanelVisible);
      rootElement.classList.toggle("is-bottom-panel-visible", layout.bottomPanelVisible);
      rootElement.style.setProperty("--zui-sidebar-width", `${layout.sidebarWidth}px`);
      rootElement.style.setProperty("--zui-right-panel-width", `${layout.rightPanelWidth}px`);
      rootElement.style.setProperty("--zui-bottom-panel-height", `${layout.bottomPanelHeight}px`);
      refs.sidebar.hidden = !layout.sidebarVisible;
      refs.rightPanel.hidden = !layout.rightPanelVisible;
      refs.bottomPanel.hidden = !layout.bottomPanelVisible;
      refs.sidebarResizer.hidden = !layout.sidebarVisible;
      refs.rightPanelResizer.hidden = !layout.rightPanelVisible;
      refs.bottomPanelResizer.hidden = !layout.bottomPanelVisible;
    }

    function set(nextLayout, notify = true) {
      const next = types.normalizeLayout(nextLayout, layout);
      const changed = JSON.stringify(next) !== JSON.stringify(layout);
      layout = next;
      apply();
      if (changed && notify) onChange(snapshot());
      return snapshot();
    }

    function clearFrame() {
      if (!frameId) return;
      windowRef.cancelAnimationFrame(frameId);
      frameId = 0;
    }

    function flushResize() {
      frameId = 0;
      if (!pendingPatch) return;
      const patch = pendingPatch;
      pendingPatch = null;
      set(patch, true);
    }

    function scheduleResize(patch) {
      pendingPatch = { ...layout, ...patch };
      if (!frameId) frameId = windowRef.requestAnimationFrame(flushResize);
    }

    function stopResize() {
      if (!resizeState) return;
      if (pendingPatch) {
        clearFrame();
        flushResize();
      }
      resizeState = null;
      documentRef.removeEventListener("pointermove", handlePointerMove);
      documentRef.removeEventListener("pointerup", stopResize);
      documentRef.removeEventListener("pointercancel", stopResize);
      documentRef.body?.classList.remove("zui-shell-resizing");
    }

    function handlePointerMove(event) {
      if (!resizeState) return;
      if (resizeState.kind === "sidebar") {
        scheduleResize({ sidebarWidth: resizeState.size + event.clientX - resizeState.x });
      } else if (resizeState.kind === "rightPanel") {
        scheduleResize({ rightPanelWidth: resizeState.size + resizeState.x - event.clientX });
      } else {
        scheduleResize({ bottomPanelHeight: resizeState.size + resizeState.y - event.clientY });
      }
    }

    function startResize(kind, event) {
      const size = kind === "sidebar"
        ? layout.sidebarWidth
        : (kind === "rightPanel" ? layout.rightPanelWidth : layout.bottomPanelHeight);
      resizeState = { kind, x: event.clientX, y: event.clientY, size };
      event.preventDefault();
      documentRef.body?.classList.add("zui-shell-resizing");
      documentRef.addEventListener("pointermove", handlePointerMove);
      documentRef.addEventListener("pointerup", stopResize);
      documentRef.addEventListener("pointercancel", stopResize);
    }

    const bindings = [
      [refs.sidebarResizer, "sidebar"],
      [refs.rightPanelResizer, "rightPanel"],
      [refs.bottomPanelResizer, "bottomPanel"]
    ];
    bindings.forEach(([element, kind]) => {
      element.addEventListener("pointerdown", (event) => startResize(kind, event));
    });
    apply();

    function destroy() {
      stopResize();
      clearFrame();
      pendingPatch = null;
    }

    return Object.freeze({ get: snapshot, set, destroy });
  }

  modules.createLayoutController = createLayoutController;
})(window);
