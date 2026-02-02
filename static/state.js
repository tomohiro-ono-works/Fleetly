window.stateOps = {
  createDefaultState() {
    return { version: 2, nodes: [createDefaultNode()] };
  },

  addNodeAfter(state, index) {
    state.nodes.splice(index + 1, 0, createNewNode());
  },

  removeNode(state, index) {
    if (state.nodes.length <= 1) return;
    state.nodes.splice(index, 1);
  }
};

function createDefaultNode() {
  return {
    id: crypto.randomUUID(),
    connector: "BQConnector",
    action: "execute_sql",
    form: {},
    outputs: ["step1"]
  };
}

function createNewNode() {
  return {
    id: crypto.randomUUID(),
    connector: "CSVConnector",
    action: "read_csv",
    form: {},
    outputs: []
  };
}
