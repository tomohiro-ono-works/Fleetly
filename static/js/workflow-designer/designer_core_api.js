(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules || {};
  const required = [
    "cloneValue",
    "normalizePosition",
    "normalizeViewport",
    "normalizeSelection",
    "normalizeStatus",
    "normalizeNodeRef",
    "normalizeEdgeRef",
    "nodeRefKey",
    "edgeRefKey",
    "sameValue",
    "createEmitter",
    "assertWorkflowDocument",
    "getDocumentPathValue",
    "applyDocumentPatch",
    "applyDocumentPatchWithInverse",
    "diffWorkflowDocuments",
    "createWorkflowIdManager",
    "buildWorkflowGraphModel",
    "copyWorkflowSelection",
    "cloneWorkflowFragment"
  ];

  required.forEach((name) => {
    if (typeof modules[name] !== "function") {
      throw new Error(`WorkflowDesigner core module is missing: ${name}`);
    }
  });

  packages.workflowDesignerCore = Object.freeze(Object.fromEntries(
    required.map((name) => [name, modules[name]])
  ));
})(window);
