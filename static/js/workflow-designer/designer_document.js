(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  function assertDocument(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("document must be an object");
    }
  }

  function assertPath(path) {
    if (!Array.isArray(path)) {
      throw new TypeError("patch path must be an array");
    }
    path.forEach((segment) => {
      const validString = typeof segment === "string" && segment.length > 0;
      const validIndex = Number.isInteger(segment) && segment >= 0;
      if (!validString && !validIndex) {
        throw new TypeError("patch path contains an invalid segment");
      }
    });
  }

  function getPathValue(document, path) {
    let current = document;
    for (const segment of path) {
      if (
        current === null ||
        typeof current !== "object" ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        return { exists: false, value: undefined };
      }
      current = current[segment];
    }
    return { exists: true, value: current };
  }

  function resolveParent(document, path) {
    if (!path.length) return { parent: null, key: null };
    let parent = document;
    for (let index = 0; index < path.length - 1; index += 1) {
      const segment = path[index];
      if (
        parent === null ||
        typeof parent !== "object" ||
        !Object.prototype.hasOwnProperty.call(parent, segment)
      ) {
        throw new Error("patch path does not exist");
      }
      parent = parent[segment];
    }
    if (parent === null || typeof parent !== "object") {
      throw new Error("patch parent is not an object or array");
    }
    return { parent, key: path[path.length - 1] };
  }

  function applyOperation(document, operation) {
    if (!operation || typeof operation !== "object") {
      throw new TypeError("patch operation must be an object");
    }
    const op = String(operation.op || "").trim();
    const path = operation.path;
    assertPath(path);

    if (!path.length) {
      if (op !== "replace" || !operation.value || typeof operation.value !== "object") {
        throw new Error("document root only supports replace");
      }
      return modules.cloneValue(operation.value);
    }

    const { parent, key } = resolveParent(document, path);
    const isArray = Array.isArray(parent);
    const exists = Object.prototype.hasOwnProperty.call(parent, key);

    if (op === "add") {
      if (!Object.prototype.hasOwnProperty.call(operation, "value")) {
        throw new Error("add operation requires value");
      }
      if (isArray) {
        if (!Number.isInteger(key) || key < 0 || key > parent.length) {
          throw new Error("array add index is out of range");
        }
        parent.splice(key, 0, modules.cloneValue(operation.value));
      } else {
        if (exists) throw new Error("add target already exists");
        parent[key] = modules.cloneValue(operation.value);
      }
      return document;
    }

    if (op === "replace") {
      if (!exists) throw new Error("replace target does not exist");
      if (!Object.prototype.hasOwnProperty.call(operation, "value")) {
        throw new Error("replace operation requires value");
      }
      parent[key] = modules.cloneValue(operation.value);
      return document;
    }

    if (op === "remove") {
      if (!exists) throw new Error("remove target does not exist");
      if (isArray) {
        if (!Number.isInteger(key)) throw new Error("array path requires an index");
        parent.splice(key, 1);
      } else {
        delete parent[key];
      }
      return document;
    }

    throw new Error(`unsupported patch operation: ${op}`);
  }

  function normalizePatch(patch) {
    if (!Array.isArray(patch)) throw new TypeError("patch must be an array");
    return patch.map((operation) => modules.cloneValue(operation));
  }

  function applyPatch(document, patch) {
    assertDocument(document);
    const operations = normalizePatch(patch);
    let next = modules.cloneValue(document);
    operations.forEach((operation) => {
      next = applyOperation(next, operation);
    });
    assertDocument(next);
    return next;
  }

  function applyPatchWithInverse(document, patch) {
    assertDocument(document);
    const operations = normalizePatch(patch);
    let next = modules.cloneValue(document);
    const inverse = [];

    operations.forEach((operation) => {
      const path = operation.path;
      assertPath(path);
      const previous = getPathValue(next, path);
      next = applyOperation(next, operation);
      if (operation.op === "add") {
        inverse.unshift({ op: "remove", path: modules.cloneValue(path) });
      } else if (operation.op === "remove") {
        inverse.unshift({
          op: "add",
          path: modules.cloneValue(path),
          value: modules.cloneValue(previous.value)
        });
      } else if (operation.op === "replace") {
        inverse.unshift({
          op: "replace",
          path: modules.cloneValue(path),
          value: modules.cloneValue(previous.value)
        });
      }
    });
    assertDocument(next);
    return { document: next, inversePatch: inverse };
  }

  function diffValues(before, after, path, patch) {
    if (modules.sameValue(before, after)) return;
    const beforeObject = before && typeof before === "object";
    const afterObject = after && typeof after === "object";
    if (Array.isArray(before) && Array.isArray(after)) {
      const sharedLength = Math.min(before.length, after.length);
      let commonPrefix = 0;
      while (
        commonPrefix < sharedLength &&
        modules.sameValue(before[commonPrefix], after[commonPrefix])
      ) {
        commonPrefix += 1;
      }
      if (commonPrefix === before.length && after.length >= before.length) {
        for (let index = before.length; index < after.length; index += 1) {
          patch.push({
            op: "add",
            path: [...path, index],
            value: modules.cloneValue(after[index])
          });
        }
        return;
      }
      if (commonPrefix === after.length && before.length > after.length) {
        for (let index = before.length - 1; index >= after.length; index -= 1) {
          patch.push({ op: "remove", path: [...path, index] });
        }
        return;
      }
      if (before.length === after.length) {
        before.forEach((item, index) => {
          diffValues(item, after[index], [...path, index], patch);
        });
        return;
      }
    }
    if (
      !beforeObject ||
      !afterObject ||
      Array.isArray(before) ||
      Array.isArray(after)
    ) {
      patch.push({
        op: "replace",
        path: modules.cloneValue(path),
        value: modules.cloneValue(after)
      });
      return;
    }

    Object.keys(before).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(after, key)) {
        patch.push({ op: "remove", path: [...path, key] });
      }
    });
    Object.keys(after).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(before, key)) {
        patch.push({
          op: "add",
          path: [...path, key],
          value: modules.cloneValue(after[key])
        });
        return;
      }
      diffValues(before[key], after[key], [...path, key], patch);
    });
  }

  function diffDocuments(before, after) {
    assertDocument(before);
    assertDocument(after);
    const patch = [];
    diffValues(before, after, [], patch);
    return patch;
  }

  modules.assertWorkflowDocument = assertDocument;
  modules.getDocumentPathValue = getPathValue;
  modules.applyDocumentPatch = applyPatch;
  modules.applyDocumentPatchWithInverse = applyPatchWithInverse;
  modules.diffWorkflowDocuments = diffDocuments;
})(window);
