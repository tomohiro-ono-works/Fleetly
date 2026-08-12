(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDocumentStoreModules =
    packages.__workflowDocumentStoreModules || {};

  function cloneValue(value) {
    if (typeof root.structuredClone === "function") {
      return root.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function sameValue(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      return left.every((item, index) => sameValue(item, right[index]));
    }
    const leftObject = left && typeof left === "object";
    const rightObject = right && typeof right === "object";
    if (!leftObject || !rightObject) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(right, key) &&
      sameValue(left[key], right[key])
    ));
  }

  function createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function requireDocument(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw createError(
        "E_DOCUMENT_INVALID",
        "documentはオブジェクトで指定してください。"
      );
    }
    return cloneValue(value);
  }

  function requirePatch(value, fieldName) {
    if (!Array.isArray(value) || !value.length) {
      throw createError(
        "E_TRANSACTION_INVALID",
        `${fieldName}は1件以上のoperation配列で指定してください。`
      );
    }
    return cloneValue(value);
  }

  function getPathValue(document, path) {
    if (!Array.isArray(path)) {
      throw createError(
        "E_TRANSACTION_INVALID",
        "patch pathは配列で指定してください。"
      );
    }
    if (!path.length) {
      return { exists: true, value: cloneValue(document) };
    }
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
    return { exists: true, value: cloneValue(current) };
  }

  function normalizeTransaction(value, newTransactionId) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw createError(
        "E_TRANSACTION_INVALID",
        "transactionはオブジェクトで指定してください。"
      );
    }
    const transactionId = String(
      value.transactionId || newTransactionId()
    ).trim();
    if (!transactionId) {
      throw createError(
        "E_TRANSACTION_INVALID",
        "transactionIdは必須です。"
      );
    }
    return {
      patch: requirePatch(value.patch, "patch"),
      inversePatch: requirePatch(value.inversePatch, "inversePatch"),
      reason: String(value.reason || "document.edit").trim(),
      transactionId
    };
  }

  function verifyTransaction(document, transaction, patchApi) {
    let next;
    let restored;
    try {
      next = patchApi(document, transaction.patch);
      restored = patchApi(next, transaction.inversePatch);
    } catch (error) {
      throw createError(
        "E_TRANSACTION_INVALID",
        String(error?.message || error)
      );
    }
    if (!sameValue(restored, document)) {
      throw createError(
        "E_TRANSACTION_INVALID",
        "inversePatchで適用前documentへ復元できません。"
      );
    }
    return next;
  }

  function buildTransaction(
    document,
    patch,
    value,
    patchApi,
    newTransactionId
  ) {
    const normalizedPatch = requirePatch(patch, "patch");
    let working = cloneValue(document);
    const inversePatch = [];
    try {
      normalizedPatch.forEach((operation) => {
        const op = String(operation?.op || "").trim();
        const path = cloneValue(operation?.path);
        const previous = getPathValue(working, path);
        working = patchApi(working, [operation]);
        if (op === "add") {
          inversePatch.unshift({ op: "remove", path });
        } else if (op === "remove") {
          inversePatch.unshift({
            op: "add",
            path,
            value: previous.value
          });
        } else if (op === "replace") {
          inversePatch.unshift({
            op: "replace",
            path,
            value: previous.value
          });
        } else {
          throw new Error(`unsupported patch operation: ${op}`);
        }
      });
    } catch (error) {
      throw createError(
        "E_TRANSACTION_INVALID",
        String(error?.message || error)
      );
    }
    return {
      patch: normalizedPatch,
      inversePatch,
      reason: String(value.reason || "document.edit").trim(),
      transactionId: String(
        value.transactionId || newTransactionId()
      ).trim()
    };
  }

  Object.assign(modules, {
    buildTransaction,
    cloneValue,
    createError,
    normalizeTransaction,
    requireDocument,
    verifyTransaction
  });
})(window);
