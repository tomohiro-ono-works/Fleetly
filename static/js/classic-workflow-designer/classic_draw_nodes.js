(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__classicWorkflowDesignerModules =
    packages.__classicWorkflowDesignerModules || {};
  const imageCache = new Map();

  function rendererFor(node, renderers) {
    if (!renderers || typeof renderers !== "object") return null;
    return renderers[node.nodeType] || renderers.default || null;
  }

  function presentationFor(node, renderers) {
    if (node.kind !== "step") {
      return {
        label: node.kind === "unassigned-start"
          ? "UNASSIGNED"
          : String(node.label || node.ref.node_id),
        detail: String(node.flowLabel || "")
      };
    }
    const renderer = rendererFor(node, renderers);
    const context = Object.freeze({
      nodeRef: packages.workflowDesignerCore.cloneValue(node.ref),
      nodeType: node.nodeType,
      kind: node.kind,
      readonly: false
    });
    if (typeof renderer?.getPresentation === "function") {
      const value = renderer.getPresentation(node.step, context);
      if (value && typeof value === "object") return value;
    }
    return {
      label: String(node.step?.label || node.ref.node_id),
      connectorLabel: String(node.step?.connector_id || node.nodeType),
      detail: String(node.step?.action_id || "")
    };
  }

  function loadImage(url, requestDraw) {
    const source = String(url || "").trim();
    if (!source) return null;
    if (imageCache.has(source)) return imageCache.get(source);
    const image = new Image();
    image.failed = false;
    image.onload = requestDraw;
    image.onerror = () => {
      image.failed = true;
      requestDraw();
    };
    image.src = source;
    imageCache.set(source, image);
    return image;
  }

  function statusValue(node, status) {
    return status.nodeStatus[node.key] ||
      status.nodeStatus[String(node.ref.node_id || "")] ||
      "idle";
  }

  function validationValue(node, status) {
    return status.validation[node.key] ||
      status.validation[String(node.ref.node_id || "")] ||
      [];
  }

  function drawPseudoIcon(ctx, node, palette) {
    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;
    ctx.strokeStyle = palette.text;
    ctx.fillStyle = palette.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 10, 0, Math.PI * 2);
    ctx.stroke();
    if (node.kind === "end") {
      ctx.fillRect(centerX - 4, centerY - 4, 8, 8);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(centerX - 3, centerY - 5);
    ctx.lineTo(centerX - 3, centerY + 5);
    ctx.lineTo(centerX + 5, centerY);
    ctx.closePath();
    ctx.fill();
  }

  function drawBadge(ctx, node, palette) {
    const text = String(node.ref.node_id || "");
    ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
    const width = Math.max(36, Math.ceil(ctx.measureText(text).width) + 12);
    const x = node.x + (node.width - width) / 2;
    const y = node.y - 8;
    ctx.fillStyle = palette.node;
    ctx.strokeStyle = palette.badgeBorder;
    ctx.lineWidth = 1;
    modules.classicRoundedRect(ctx, x, y, width, 16, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + width / 2, y + 8);
  }

  function drawStatus(ctx, node, value, palette) {
    const labels = {
      running: "Running",
      success: "Success",
      error: "ERROR",
      skipped: "Skipped"
    };
    const label = labels[value] || "";
    if (!label) return;
    const color = value === "running"
      ? palette.running
      : value === "success"
        ? palette.success
        : value === "error"
          ? palette.error
          : palette.textMuted;
    ctx.font = "700 9px 'Segoe UI', 'Yu Gothic UI', sans-serif";
    const width = Math.ceil(ctx.measureText(label).width) + 10;
    const x = node.x + node.width - 3;
    const y = node.y - 19;
    ctx.fillStyle = color;
    modules.classicRoundedRect(ctx, x, y, width, 16, 8);
    ctx.fill();
    ctx.fillStyle = palette.node;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + width / 2, y + 8);
  }

  function drawValidation(ctx, node, entries, palette) {
    if (!entries.length) return;
    const color = entries.some((entry) => entry.level === "error")
      ? palette.error
      : palette.warning;
    const x = node.x + node.width - 1;
    const y = node.y + 3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.node;
    ctx.font = "700 11px 'Segoe UI', 'Yu Gothic UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", x, y + 0.5);
  }

  function drawPorts(ctx, node, palette, visible) {
    if (!visible) return;
    const centers = [];
    if (!["start", "unassigned-start"].includes(node.kind)) {
      centers.push({ x: node.x, y: node.y + node.height / 2 });
    }
    if (node.kind !== "end") {
      centers.push({
        x: node.x + node.width,
        y: node.y + node.height / 2
      });
    }
    centers.forEach((center) => {
      ctx.fillStyle = palette.node;
      ctx.strokeStyle = palette.edgeSelected;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  function drawClassicNode(ctx, node, options) {
    const selected = options.selectedKeys.has(node.key);
    const preview = options.nodePreview.get(node.key) || { dx: 0, dy: 0 };
    const display = {
      ...node,
      x: node.x + preview.dx,
      y: node.y + preview.dy
    };
    const presentation = presentationFor(node, options.renderers);
    const status = statusValue(node, options.status);
    const validation = validationValue(node, options.status);
    const pseudo = display.kind !== "step";

    ctx.save();
    ctx.shadowColor = options.palette.shadow;
    ctx.shadowBlur = pseudo ? 2 : selected ? 7 : 5;
    ctx.shadowOffsetY = pseudo ? 1 : 2;
    ctx.fillStyle = pseudo ? options.palette.pseudo : options.palette.node;
    ctx.strokeStyle = selected
      ? options.palette.selected
      : status === "running"
        ? options.palette.running
        : status === "success"
          ? options.palette.success
          : status === "error"
            ? options.palette.error
            : pseudo
              ? options.palette.pseudoBorder
              : options.palette.nodeBorder;
    ctx.lineWidth = selected || status !== "idle" ? 3 : 1.4;
    modules.classicRoundedRect(
      ctx,
      display.x,
      display.y,
      display.width,
      display.height,
      pseudo ? 18 : 8
    );
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = "transparent";

    if (display.kind === "step") {
      drawBadge(ctx, display, options.palette);
      const image = loadImage(presentation.iconUrl, options.requestDraw);
      if (
        image &&
        !image.failed &&
        image.complete &&
        image.naturalWidth > 0
      ) {
        const scale = Math.min(
          42 / image.naturalWidth,
          42 / image.naturalHeight
        );
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        ctx.drawImage(
          image,
          display.x + (display.width - width) / 2,
          display.y + (display.height - height) / 2,
          width,
          height
        );
      } else {
        ctx.fillStyle = options.palette.text;
        ctx.font = "700 12px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          String(presentation.connectorLabel || display.nodeType).slice(0, 8),
          display.x + display.width / 2,
          display.y + display.height / 2
        );
      }
      ctx.fillStyle = options.palette.text;
      ctx.font = "12px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = String(presentation.label || display.label);
      modules.classicWrapText(ctx, label, 120, 2).forEach((line, index) => {
        ctx.fillText(
          line,
          display.x + display.width / 2,
          display.y + display.height + 7 + index * 15
        );
      });
    } else {
      drawPseudoIcon(ctx, display, options.palette);
      ctx.fillStyle = options.palette.textMuted;
      ctx.font = "10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(
        String(presentation.label || ""),
        display.x + display.width / 2,
        display.y + display.height + 6
      );
      if (presentation.detail) {
        ctx.fillText(
          String(presentation.detail),
          display.x + display.width / 2,
          display.y + display.height + 20
        );
      }
    }
    drawStatus(ctx, display, status, options.palette);
    drawValidation(ctx, display, validation, options.palette);
    drawPorts(
      ctx,
      display,
      options.palette,
      !options.readonly && (
        selected || options.hoverKey === node.key || options.connecting
      )
    );
    ctx.restore();
  }

  modules.drawClassicNode = drawClassicNode;
})(window);
