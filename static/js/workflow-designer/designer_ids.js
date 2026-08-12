(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  const ID_KINDS = Object.freeze(["step", "flow", "note"]);

  function collectIds(document, kind) {
    if (kind === "step") {
      return (Array.isArray(document?.steps) ? document.steps : [])
        .map((step) => String(step?.step_id || "").trim())
        .filter(Boolean);
    }
    if (kind === "flow") {
      return Object.keys(
        document?.flows && typeof document.flows === "object"
          ? document.flows
          : {}
      ).map((value) => String(value).trim()).filter(Boolean);
    }
    return (Array.isArray(document?.notes) ? document.notes : [])
      .map((note) => String(note?.note_id || "").trim())
      .filter(Boolean);
  }

  function numericValue(value) {
    const text = String(value || "").trim();
    if (!/^(?:0*[1-9]\d*)$/.test(text)) return 0;
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : 0;
  }

  function formatStandardId(value) {
    return String(value).padStart(2, "0");
  }

  function createIdManager(customAllocator, initialDocument) {
    const issued = new Map(ID_KINDS.map((kind) => [kind, new Set()]));
    const highWater = new Map(ID_KINDS.map((kind) => [kind, 0]));

    function assertKind(kind) {
      if (!ID_KINDS.includes(kind)) {
        throw new TypeError(`unknown id kind: ${kind}`);
      }
    }

    function observe(document) {
      ID_KINDS.forEach((kind) => {
        collectIds(document, kind).forEach((id) => {
          issued.get(kind).add(id);
          highWater.set(kind, Math.max(highWater.get(kind), numericValue(id)));
        });
      });
    }

    function validateAllocated(kind, values, count, document) {
      if (!Array.isArray(values) || values.length !== count) {
        throw new Error(`idAllocator must return ${count} ${kind} id(s)`);
      }
      const normalized = values.map((value) => String(value || "").trim());
      if (normalized.some((value) => !value)) {
        throw new Error("idAllocator returned an empty id");
      }
      if (new Set(normalized).size !== normalized.length) {
        throw new Error("idAllocator returned duplicate ids");
      }
      const existing = new Set([
        ...collectIds(document, kind),
        ...issued.get(kind)
      ]);
      if (normalized.some((value) => existing.has(value))) {
        throw new Error("idAllocator returned an existing or retired id");
      }
      return normalized;
    }

    function allocate(kind, count, document) {
      assertKind(kind);
      const size = Number(count);
      if (!Number.isInteger(size) || size < 1) {
        throw new TypeError("id allocation count must be a positive integer");
      }
      observe(document);
      let values;
      if (typeof customAllocator === "function") {
        values = customAllocator({
          idKind: kind,
          document: modules.cloneValue(document),
          count: size
        });
        if (values && typeof values.then === "function") {
          throw new Error("idAllocator must be synchronous");
        }
      } else {
        values = [];
        let candidate = highWater.get(kind);
        while (values.length < size) {
          candidate += 1;
          const id = formatStandardId(candidate);
          if (!issued.get(kind).has(id)) values.push(id);
        }
      }
      const normalized = validateAllocated(kind, values, size, document);
      normalized.forEach((id) => {
        issued.get(kind).add(id);
        highWater.set(kind, Math.max(highWater.get(kind), numericValue(id)));
      });
      return normalized;
    }

    observe(initialDocument || {});
    return Object.freeze({ allocate, observe });
  }

  modules.createWorkflowIdManager = createIdManager;
  modules.collectWorkflowIds = collectIds;
})(window);
