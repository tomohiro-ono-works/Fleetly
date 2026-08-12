(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  function createSelectionController(controller) {
    function selectNode(node, additive) {
      const current = controller.getSelection();
      const key = modules.nodeRefKey(node.ref);
      let nodes = current.nodes;
      if (additive) {
        const selected = new Set(nodes.map(modules.nodeRefKey));
        nodes = selected.has(key)
          ? nodes.filter((ref) => modules.nodeRefKey(ref) !== key)
          : [...nodes, modules.cloneValue(node.ref)];
      } else if (
        current.nodes.length !== 1 ||
        modules.nodeRefKey(current.nodes[0]) !== key
      ) {
        nodes = [modules.cloneValue(node.ref)];
      }
      controller.select({
        nodes,
        edges: additive ? current.edges : [],
        annotation_ids: additive ? current.annotation_ids : []
      }, "pointer");
    }

    function selectEdge(edge, additive) {
      const current = controller.getSelection();
      const key = modules.edgeRefKey(edge.ref);
      let edges = current.edges;
      if (additive) {
        const selected = new Set(edges.map(modules.edgeRefKey));
        edges = selected.has(key)
          ? edges.filter((ref) => modules.edgeRefKey(ref) !== key)
          : [...edges, modules.cloneValue(edge.ref)];
      } else {
        edges = [modules.cloneValue(edge.ref)];
      }
      controller.select({
        nodes: additive ? current.nodes : [],
        edges,
        annotation_ids: additive ? current.annotation_ids : []
      }, "pointer");
    }

    function selectNote(noteId, additive) {
      const current = controller.getSelection();
      let ids = current.annotation_ids;
      if (additive) {
        ids = ids.includes(noteId)
          ? ids.filter((id) => id !== noteId)
          : [...ids, noteId];
      } else {
        ids = [noteId];
      }
      controller.select({
        nodes: additive ? current.nodes : [],
        edges: additive ? current.edges : [],
        annotation_ids: ids
      }, "pointer");
    }

    return Object.freeze({ selectNode, selectEdge, selectNote });
  }

  modules.createWorkflowSelectionController = createSelectionController;
})(window);
