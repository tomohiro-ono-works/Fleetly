(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const app = packages.app = packages.app || {};
  const storeModules = packages.__workflowDocumentStoreModules || {};

  function createWorkflowDocumentStore(options = {}) {
    const {
      buildTransaction,
      cloneValue,
      createError,
      normalizeTransaction,
      requireDocument,
      verifyTransaction
    } = storeModules;
    if (
      typeof buildTransaction !== "function" ||
      typeof cloneValue !== "function" ||
      typeof createError !== "function" ||
      typeof normalizeTransaction !== "function" ||
      typeof requireDocument !== "function" ||
      typeof verifyTransaction !== "function"
    ) {
      throw new Error("workflow document store helperが利用できません。");
    }
    const patchApi = packages.workflowDesigner?.applyDocumentPatch;
    if (typeof patchApi !== "function") {
      throw createError(
        "E_NOT_READY",
        "WorkflowDesignerのdocument patch APIが利用できません。"
      );
    }

    const historyLimit = Math.max(
      1,
      Number(options.historyLimit) || 100
    );
    let documentState = requireDocument(options.document || {});
    let metadata = normalizeMetadata(options);
    let revisionSequence = 0;
    let transactionSequence = 0;
    let history = [];
    let revisions = [newRevisionId()];
    let cursor = 0;
    let savedRevisionId = revisions[0];
    let destroyed = false;
    const transactionIds = new Set();
    const subscribers = new Set();

    function newRevisionId() {
      revisionSequence += 1;
      return `wdocrev_${Date.now()}_${revisionSequence}`;
    }

    function newTransactionId() {
      transactionSequence += 1;
      return `wdoctx_${Date.now()}_${transactionSequence}`;
    }

    function normalizeMetadata(value = {}) {
      return {
        doc_session_id: String(value.doc_session_id || "").trim(),
        document_ref: String(value.document_ref || "").trim(),
        file_name: String(value.file_name || "").trim(),
        mode: String(value.mode || "dataflow").trim() || "dataflow"
      };
    }

    function currentRevisionId() {
      return revisions[cursor];
    }

    function snapshot() {
      return {
        document: cloneValue(documentState),
        metadata: cloneValue(metadata),
        revision_id: currentRevisionId(),
        saved_revision_id: savedRevisionId,
        dirty: currentRevisionId() !== savedRevisionId,
        can_undo: cursor > 0,
        can_redo: cursor < history.length
      };
    }

    function notify(type, transaction = null) {
      const change = {
        type: String(type || "change"),
        ...snapshot(),
        transaction: transaction ? cloneValue(transaction) : null
      };
      subscribers.forEach((subscriber) => {
        try {
          subscriber(change);
        } catch (error) {
          console.error("workflow document subscriber failed", error);
        }
      });
      return change;
    }

    function assertActive() {
      if (destroyed) {
        throw createError(
          "E_NOT_READY",
          "workflow document storeは破棄されています。"
        );
      }
    }

    function commit(transaction, nextDocument) {
      if (transactionIds.has(transaction.transactionId)) {
        throw createError(
          "E_TRANSACTION_DUPLICATE",
          "同じtransactionIdは再適用できません。"
        );
      }
      if (cursor < history.length) {
        history = history.slice(0, cursor);
        revisions = revisions.slice(0, cursor + 1);
      }
      const beforeRevisionId = currentRevisionId();
      const afterRevisionId = newRevisionId();
      const entry = {
        ...cloneValue(transaction),
        beforeRevisionId,
        afterRevisionId
      };
      documentState = nextDocument;
      history.push(entry);
      revisions.push(afterRevisionId);
      cursor += 1;
      transactionIds.add(transaction.transactionId);
      trimHistory();
      return notify("transaction", transaction);
    }

    function trimHistory() {
      while (history.length > historyLimit) {
        history.shift();
        revisions.shift();
        cursor -= 1;
      }
    }

    function applyTransaction(value) {
      assertActive();
      const transaction = normalizeTransaction(value, newTransactionId);
      if (transactionIds.has(transaction.transactionId)) {
        throw createError(
          "E_TRANSACTION_DUPLICATE",
          "同じtransactionIdは再適用できません。"
        );
      }
      const nextDocument = verifyTransaction(
        documentState,
        transaction,
        patchApi
      );
      return commit(transaction, nextDocument);
    }

    function applyPatch(patch, value = {}) {
      assertActive();
      return applyTransaction(buildTransaction(
        documentState,
        patch,
        value,
        patchApi,
        newTransactionId
      ));
    }

    function undo() {
      assertActive();
      if (cursor <= 0) return null;
      const entry = history[cursor - 1];
      documentState = patchApi(documentState, entry.inversePatch);
      cursor -= 1;
      return notify("undo", entry);
    }

    function redo() {
      assertActive();
      if (cursor >= history.length) return null;
      const entry = history[cursor];
      documentState = patchApi(documentState, entry.patch);
      cursor += 1;
      return notify("redo", entry);
    }

    function load(value = {}) {
      assertActive();
      documentState = requireDocument(value.document);
      metadata = normalizeMetadata({
        ...metadata,
        ...value
      });
      history = [];
      revisions = [newRevisionId()];
      cursor = 0;
      savedRevisionId = revisions[0];
      transactionIds.clear();
      return notify("load");
    }

    function markSaved(value = {}) {
      assertActive();
      metadata = normalizeMetadata({
        ...metadata,
        ...value
      });
      savedRevisionId = currentRevisionId();
      return notify("saved");
    }

    function subscribe(subscriber, value = {}) {
      assertActive();
      if (typeof subscriber !== "function") {
        throw new TypeError("subscriberは関数で指定してください。");
      }
      subscribers.add(subscriber);
      if (value.emitCurrent === true) {
        subscriber({ type: "current", ...snapshot(), transaction: null });
      }
      return () => subscribers.delete(subscriber);
    }

    const api = Object.freeze({
      getDocument() {
        assertActive();
        return cloneValue(documentState);
      },
      getSnapshot() {
        assertActive();
        return snapshot();
      },
      applyTransaction,
      applyPatch,
      undo,
      redo,
      load,
      markSaved,
      subscribe,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        subscribers.clear();
        history = [];
        revisions = [];
        documentState = {};
      }
    });
    return api;
  }

  app.workflowDocumentStore = Object.freeze({
    createWorkflowDocumentStore
  });
})(window);
