window.varsOps = {
  getAvailableVars(state, nodeIndex) {
    const vars = [];
    for (let i = 0; i < nodeIndex; i++) {
      const outs = state.nodes[i].outputs || [];
      for (const v of outs) vars.push(v);
    }
    return [...new Set(vars)];
  }
};
