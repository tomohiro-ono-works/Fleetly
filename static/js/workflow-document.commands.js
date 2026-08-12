(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const app = packages.app = packages.app || {};
  const modules = packages.__workflowDocumentCommandModules || {};

  function requireModule(name) {
    if (typeof modules[name] !== "function") {
      throw new Error(`workflow document command helperが不足しています: ${name}`);
    }
    return modules[name];
  }

  function createWorkflowDocumentCommands(options = {}) {
    const store = options.store;
    if (
      !store ||
      typeof store.getDocument !== "function" ||
      typeof store.applyPatch !== "function"
    ) {
      throw new TypeError("workflow document storeが必要です。");
    }
    const createIdAllocator = requireModule("createIdAllocator");
    const planAddFlow = requireModule("planAddWorkflowFlow");
    const planConnection = requireModule("planWorkflowConnection");
    const planDelete = requireModule("planDeleteWorkflowSelection");
    const planUpdateFlow = requireModule("planUpdateWorkflowFlow");
    const planUpdateMetadata = requireModule("planUpdateWorkflowMetadata");
    const planUpdateStep = requireModule("planUpdateWorkflowStep");
    const cloneValue = requireModule("cloneValue");
    const idAllocator = createIdAllocator(
      options.idAllocator,
      store.getDocument()
    );
    const catalog = options.catalog || null;

    function applyPlan(plan, reason) {
      const details = {
        invalidated_step_ids: cloneValue(
          plan.invalidated_step_ids || []
        )
      };
      ["created", "edge", "assigned_step_ids", "deleted_step_ids",
        "deleted_note_ids"].forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(plan, field)) {
          details[field] = cloneValue(plan[field]);
        }
      });
      if (!Array.isArray(plan.patch) || !plan.patch.length) {
        return { changed: false, ...details };
      }
      const change = store.applyPatch(plan.patch, { reason });
      return {
        changed: true,
        revision_id: change.revision_id,
        transaction_id: change.transaction?.transactionId || "",
        ...details
      };
    }

    function connect(sourceNodeRef, targetNodeRef) {
      const plan = planConnection(
        store.getDocument(),
        sourceNodeRef,
        targetNodeRef
      );
      return applyPlan(plan, "edge.connect");
    }

    function canConnect(sourceNodeRef, targetNodeRef, value = {}) {
      try {
        planConnection(
          value.document || store.getDocument(),
          sourceNodeRef,
          targetNodeRef
        );
        return { allowed: true };
      } catch (error) {
        return {
          allowed: false,
          code: String(error?.code || "E_CONNECT_INVALID"),
          message: String(error?.message || error)
        };
      }
    }

    const api = Object.freeze({
      allocateIds(request) {
        return idAllocator.allocate(request);
      },
      addFlow(value = {}) {
        return applyPlan(
          planAddFlow(
            store.getDocument(),
            catalog,
            (request) => idAllocator.allocate(request),
            value
          ),
          "flow.add"
        );
      },
      connect,
      canConnect,
      deleteSelection(selection) {
        return applyPlan(
          planDelete(store.getDocument(), selection),
          "selection.delete"
        );
      },
      updateStep(stepId, changes) {
        return applyPlan(
          planUpdateStep(store.getDocument(), catalog, stepId, changes),
          "property.step"
        );
      },
      updateFlow(flowId, changes) {
        return applyPlan(
          planUpdateFlow(store.getDocument(), flowId, changes),
          "property.flow"
        );
      },
      updateMetadata(changes) {
        return applyPlan(
          planUpdateMetadata(store.getDocument(), changes),
          "property.metadata"
        );
      }
    });
    return api;
  }

  app.workflowDocumentCommands = Object.freeze({
    createWorkflowDocumentCommands
  });
})(window);
