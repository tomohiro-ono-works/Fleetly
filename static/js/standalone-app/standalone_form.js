(function () {
  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, cloneValue(item)])
      );
    }
    return value;
  }

  function isEmpty(value) {
    return value === undefined
      || value === null
      || value === ""
      || (Array.isArray(value) && value.length === 0);
  }

  function outputKey(field) {
    return String(field?.exportKey || field?.key || "").trim();
  }

  function isVisible(field, values) {
    const condition = field?.visible_if;
    if (!condition || typeof condition !== "object") return true;
    const current = values[String(condition.key || "")];
    if (Object.prototype.hasOwnProperty.call(condition, "equals")) {
      return current === condition.equals;
    }
    if (Array.isArray(condition.in)) {
      return condition.in.includes(current);
    }
    return true;
  }

  function create(options = {}) {
    const host = options.host;
    const fieldsApi = window.zizPackages?.ui?.fields || null;
    if (!(host instanceof HTMLElement)) {
      throw new Error("standalone formのhostが不正です。");
    }
    if (!fieldsApi || typeof fieldsApi.renderField !== "function") {
      throw new Error("standalone formに必要なfield rendererがありません。");
    }

    const values = (
      options.values
      && typeof options.values === "object"
      && !Array.isArray(options.values)
    ) ? options.values : {};
    const excluded = new Set(
      [...(options.excludeKeys || [])].map((value) => String(value || ""))
    );
    const fields = [...(options.fields || [])]
      .filter((field) => {
        const key = String(field?.key || "");
        return key && !excluded.has(key) && !excluded.has(outputKey(field));
      })
      .map((field) => ({ ...field }));

    fields.forEach((field) => {
      if (
        !Object.prototype.hasOwnProperty.call(values, field.key)
        && Object.prototype.hasOwnProperty.call(field, "default")
      ) {
        values[field.key] = cloneValue(field.default);
      }
    });

    const body = document.createElement("div");
    body.className = "standalone-param-form";
    const node = {
      connectorId: String(options.connectorId || ""),
      actionId: String(options.actionId || ""),
      docSessionId: String(options.docSessionId || ""),
      stepName: "standalone",
      form: values
    };
    const renderState = {};

    fields.forEach((field) => {
      body.appendChild(fieldsApi.renderField({
        node,
        field,
        upstreamSteps: [],
        availableVariableNames: [],
        hiddenBindings: options.hiddenBindings || {},
        state: renderState,
        config: options.config || {},
        plainSchemaEditor: true,
        onStateChanged: () => {
          if (typeof options.onChange === "function") {
            options.onChange(values);
          }
        }
      }));
    });
    host.replaceChildren(body);

    function getValues() {
      const result = {};
      fields.forEach((field) => {
        if (
          field.kind === "google-auth-login"
          || !isVisible(field, values)
        ) {
          return;
        }
        const value = Object.prototype.hasOwnProperty.call(values, field.key)
          ? values[field.key]
          : field.default;
        if (field.required && isEmpty(value)) {
          const error = new Error(`${field.label || field.key} は必須です。`);
          error.code = "E_VALIDATION";
          throw error;
        }
        if (isEmpty(value) && !field.required) return;
        result[outputKey(field)] = cloneValue(value);
      });
      return result;
    }

    function setDisabled(disabled) {
      body.querySelectorAll("input, select, textarea, button").forEach((control) => {
        control.disabled = disabled === true;
      });
      body.classList.toggle("is-disabled", disabled === true);
    }

    function destroy() {
      host.replaceChildren();
    }

    return Object.freeze({
      getValues,
      setDisabled,
      destroy,
      getFieldCount: () => fields.length
    });
  }

  const packages = window.zizPackages = window.zizPackages || {};
  const app = packages.app = packages.app || {};
  app.standaloneForm = Object.freeze({ create });
})();
