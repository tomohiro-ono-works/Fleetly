const utils = {
  el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = String(v ?? "");
      else if (k === "html") throw new Error("utils.el の html 属性は使用できません。");
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) node.appendChild(c);
    return node;
  },

  getFormSchema(config, connector, action) {
    const actionConfig = (config?.actions?.[connector] || [])
      .find((item) => item.id === action) || null;
    const formSchemaId = actionConfig?.formSchemaId || `${connector}.${action}`;
    return (config?.forms && config.forms[formSchemaId]) || [];
  },

  downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // =========================================================
  // YAML
  // =========================================================
  downloadYaml(filename, obj) {
    const yaml = this.toYaml(obj);
    const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  toYaml(obj) {
    const indent = (n) => "  ".repeat(n);

    const needsQuotes = (s) => {
      if (s === "") return true;
      // YAMLで紛らわしい文字や、先頭/末尾空白などはクオート
      return /[:#\-\?\[\]\{\},&\*\!\|\>\<\=\%@`]/.test(s) || /^\s|\s$/.test(s);
    };

    const quote = (s) =>
      `"${String(s)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t")}"`;


    const scalar = (v, lvl) => {
      if (v === null || v === undefined) return "null";
      if (typeof v === "number" || typeof v === "boolean") return String(v);

      const s = String(v);

      // 改行がある文字列は block scalar にする
      if (s.includes("\n")) {
        const lines = s.replace(/\r\n/g, "\n").split("\n");
        const body = lines.map((ln) => indent(lvl + 1) + ln).join("\n");
        return `|-\n${body}`;
      }

      return quote(s);
    };

    const dump = (v, lvl) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return "[]";
        return v
          .map((item) => {
            if (item && typeof item === "object") {
              return `${indent(lvl)}- ${dump(item, lvl + 1).replace(/^\s+/, "")}`;
            }
            return `${indent(lvl)}- ${scalar(item, lvl)}`;
          })
          .join("\n");
      }

      if (v && typeof v === "object") {
        const keys = Object.keys(v);
        if (keys.length === 0) return "{}";
        return keys
          .map((k) => {
            const vv = v[k];
            const isArray = Array.isArray(vv);
            const isObject = !!vv && typeof vv === "object";
            if (isArray || isObject) {
              if (isArray && vv.length === 0) {
                return `${indent(lvl)}${k}: []`;
              }
              if (isObject && !isArray && Object.keys(vv).length === 0) {
                return `${indent(lvl)}${k}: {}`;
              }
              const rendered = dump(vv, lvl + 1);
              return `${indent(lvl)}${k}:\n${rendered}`;
            } else {
              return `${indent(lvl)}${k}: ${scalar(vv, lvl)}`;
            }
          })
          .join("\n");
      }

      return scalar(v, lvl);
    };

    return dump(obj, 0) + "\n";
  }
};

const __zizPackagesUtils = window.zizPackages = window.zizPackages || {};
const __zizCoreUtils = __zizPackagesUtils.core = __zizPackagesUtils.core || {};
__zizCoreUtils.utils = utils;
