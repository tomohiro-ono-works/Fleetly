window.varsOps = {
  // nodeIndex より上に存在する step 変数を返す
  getAvailableVars(state, nodeIndex) {
    const vars = [];
    for (let i = 0; i < nodeIndex; i++) {
      vars.push(`step${i + 1}`);
    }
    return vars;
  }
};
