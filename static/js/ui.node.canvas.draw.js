(function () {
  const packages = window.zizPackages = window.zizPackages || {};
  const uiPkg = packages.ui = packages.ui || {};
  const shared = uiPkg.nodeShared || window.uiNodeShared || {};
  const {
    hasMissingRequiredField,
    hasInvalidUpstreamReference,
    getConnectorImageSrc,
    NOIMAGE_SRC
  } = shared;

  const nodeCanvasParts = uiPkg.nodeCanvasParts = uiPkg.nodeCanvasParts || window.uiNodeCanvasParts || {};
  window.uiNodeCanvasParts = nodeCanvasParts;
  const constants = nodeCanvasParts.constants || {};
  const { NODE_W, NODE_H } = constants;
  const ICON_CACHE = new Map();

  function wrapText(ctx, text, maxWidth) {
    const chars = String(text || "").split("");
    let line = "";
    let lines = [];
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i];
      if (ctx.measureText(testLine).width > maxWidth && i > 0) {
        lines.push(line);
        line = chars[i];
      } else {
        line = testLine;
      }
    }
    lines.push(line);
    if (lines.length > 2) {
      lines = [lines[0], `${lines[1].slice(0, Math.max(0, lines[1].length - 1))}…`];
    }
    return lines;
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  function drawOneSideRoundedRect(ctx, x, y, w, h, side) {
    const r = Math.min(h / 2, w / 2);
    const cy = y + h / 2;

    ctx.beginPath();
    if (side === "left") {
      const cx = x + r;
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + r, y);
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.lineTo(x + w, y + h);
    } else {
      const cx = x + w - r;
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - r, y);
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.lineTo(x, y + h);
    }
    ctx.closePath();
  }

  function drawArrowHead(ctx, x, y, angle, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function getRoundedRectPerimeter(width, height, radius) {
    return ((width - radius * 2) * 2) + ((height - radius * 2) * 2) + (Math.PI * 2 * radius);
  }

  function getRoundedRectPoint(x, y, width, height, radius, distance) {
    const straightW = width - radius * 2;
    const straightH = height - radius * 2;
    const arcLen = (Math.PI * radius) / 2;
    const perimeter = getRoundedRectPerimeter(width, height, radius) || 1;
    let d = distance % perimeter;
    if (d < 0) d += perimeter;

    const segments = [
      { len: straightW, point: (t) => ({ x: x + radius + t, y, angle: 0 }) },
      {
        len: arcLen,
        point: (t) => {
          const a = (-Math.PI / 2) + (t / arcLen) * (Math.PI / 2);
          return {
            x: x + width - radius + Math.cos(a) * radius,
            y: y + radius + Math.sin(a) * radius,
            angle: a + Math.PI / 2
          };
        }
      },
      { len: straightH, point: (t) => ({ x: x + width, y: y + radius + t, angle: Math.PI / 2 }) },
      {
        len: arcLen,
        point: (t) => {
          const a = (t / arcLen) * (Math.PI / 2);
          return {
            x: x + width - radius + Math.cos(a) * radius,
            y: y + height - radius + Math.sin(a) * radius,
            angle: a + Math.PI / 2
          };
        }
      },
      { len: straightW, point: (t) => ({ x: x + width - radius - t, y: y + height, angle: Math.PI }) },
      {
        len: arcLen,
        point: (t) => {
          const a = (Math.PI / 2) + (t / arcLen) * (Math.PI / 2);
          return {
            x: x + radius + Math.cos(a) * radius,
            y: y + height - radius + Math.sin(a) * radius,
            angle: a + Math.PI / 2
          };
        }
      },
      { len: straightH, point: (t) => ({ x, y: y + height - radius - t, angle: -Math.PI / 2 }) },
      {
        len: arcLen,
        point: (t) => {
          const a = Math.PI + (t / arcLen) * (Math.PI / 2);
          return {
            x: x + radius + Math.cos(a) * radius,
            y: y + radius + Math.sin(a) * radius,
            angle: a + Math.PI / 2
          };
        }
      }
    ];

    for (const segment of segments) {
      if (d <= segment.len) return segment.point(d);
      d -= segment.len;
    }
    return segments[0].point(0);
  }

  function drawRunningOrbit(ctx, node, color, animationNow) {
    const orbitPadding = 6;
    const orbitX = node.x - orbitPadding;
    const orbitY = node.y - orbitPadding;
    const orbitW = NODE_W + orbitPadding * 2;
    const orbitH = NODE_H + orbitPadding * 2;
    const orbitR = 12;
    const perimeter = getRoundedRectPerimeter(orbitW, orbitH, orbitR);
    const segmentLength = Math.max(48, Math.min(96, perimeter * 0.32));
    const progress = ((animationNow % 1400) / 1400) * perimeter;
    const headPoint = getRoundedRectPoint(orbitX, orbitY, orbitW, orbitH, orbitR, progress + segmentLength);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([segmentLength, perimeter]);
    ctx.lineDashOffset = -progress;
    drawRoundedRect(ctx, orbitX, orbitY, orbitW, orbitH, orbitR);
    ctx.stroke();
    ctx.setLineDash([]);
    drawArrowHead(ctx, headPoint.x, headPoint.y, headPoint.angle, 6, color);
    ctx.restore();
  }

  function wrapNoteText(ctx, text, maxWidth) {
    const source = String(text || "");
    if (!source) return [];
    const lines = [];
    source.split(/\r?\n/).forEach((segment) => {
      if (!segment) {
        lines.push("");
        return;
      }
      const chars = segment.split("");
      let line = "";
      chars.forEach((ch) => {
        const nextLine = line + ch;
        if (line && ctx.measureText(nextLine).width > maxWidth) {
          lines.push(line);
          line = ch;
        } else {
          line = nextLine;
        }
      });
      lines.push(line);
    });
    return lines;
  }

  function isStickyLinkLine(text) {
    return /^https:\/\//.test(String(text || "").trim());
  }

  function wrapStickyNoteTextWithMeta(ctx, text, maxWidth) {
    const source = String(text || "");
    if (!source) return [];
    const lines = [];
    source.split(/\r?\n/).forEach((segment) => {
      const raw = String(segment || "");
      const linkLine = isStickyLinkLine(raw);
      const href = linkLine ? raw.trim() : "";
      if (!raw) {
        lines.push({ text: "", isLink: false });
        return;
      }
      const chars = raw.split("");
      let line = "";
      chars.forEach((ch) => {
        const nextLine = line + ch;
        if (line && ctx.measureText(nextLine).width > maxWidth) {
          lines.push({ text: line, isLink: linkLine, href });
          line = ch;
        } else {
          line = nextLine;
        }
      });
      lines.push({ text: line, isLink: linkLine, href });
    });
    return lines;
  }

  function resolveRenderedStickyNotes(view, model) {
    const notes = Array.isArray(model?.stickyNotes) ? model.stickyNotes.map((note) => ({ ...note })) : [];
    const preview = view?.stickyNotePreview;
    if (!preview || !preview.id) return notes;
    const index = notes.findIndex((note) => note.id === preview.id);
    if (index >= 0) {
      notes[index] = { ...notes[index], ...preview };
      return notes;
    }
    notes.push({ ...preview });
    return notes;
  }

  function drawStickyNotes(ctx, notes, options = {}) {
    const view = options.view || null;
    if (view) view.stickyLinkHitAreas = [];
    if (!Array.isArray(notes) || !notes.length) return;
    const mode = String(options.mode || "normal");
    const selectedId = String(options.selectedId || "");
    const editable = !!options.editable;
    const noteOpacity = 0.95;
    const textColor = "#2b2f3d";
    const linkColor = "#1a5fd0";
    const selectedColor = "#5e1ef6";
    const handleSize = 14;
    const linkEnabled = mode === "normal";
    const stickyLinkHitAreas = [];
    notes.forEach((note) => {
      if (!note) return;
      const x = Math.round(Number(note.x) || 0);
      const y = Math.round(Number(note.y) || 0);
      const w = Math.max(120, Math.round(Number(note.w) || 0));
      const h = Math.max(72, Math.round(Number(note.h) || 0));
      const isSelected = selectedId && note.id === selectedId;
      const fill = String(note.color || "#ebebf2");

      ctx.save();
      ctx.globalAlpha = noteOpacity;
      ctx.fillStyle = fill;
      drawRoundedRect(ctx, x, y, w, h, 10);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = textColor;
      ctx.font = "13px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const lines = wrapStickyNoteTextWithMeta(ctx, String(note.text || ""), Math.max(20, w - 16));
      const lineHeight = 17;
      const maxLines = Math.max(1, Math.floor((h - 12) / lineHeight));
      lines.slice(0, maxLines).forEach((lineEntry, idx) => {
        const rawLine = String(lineEntry?.text || "");
        const rendered = idx === maxLines - 1 && lines.length > maxLines
          ? `${rawLine.slice(0, Math.max(0, rawLine.length - 1))}…`
          : rawLine;
        const lineX = x + 8;
        const lineY = y + 7 + idx * lineHeight;
        const isLink = linkEnabled && !!lineEntry?.isLink && !!String(rendered || "").trim();
        ctx.fillStyle = isLink ? linkColor : textColor;
        ctx.fillText(rendered, lineX, lineY);
        if (isLink) {
          const linkWidth = Math.ceil(ctx.measureText(rendered).width);
          const underlineY = lineY + 15;
          ctx.strokeStyle = linkColor;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(lineX, underlineY);
          ctx.lineTo(lineX + linkWidth, underlineY);
          ctx.stroke();
          stickyLinkHitAreas.push({
            noteId: String(note.id || ""),
            href: String(lineEntry?.href || "").trim(),
            x: lineX,
            y: lineY,
            w: linkWidth,
            h: lineHeight
          });
        }
      });

      if (editable && isSelected) {
        ctx.fillStyle = selectedColor;
        ctx.globalAlpha = 0.9;
        const hx = x + w - handleSize;
        const hy = y + h - handleSize;
        drawRoundedRect(ctx, hx, hy, handleSize, handleSize, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    });
    if (view) view.stickyLinkHitAreas = stickyLinkHitAreas;
  }

  function getConnectorIconSrc(nodeRef, config) {
    const explicitConnectorId = String(nodeRef?.form?.selected_connector_icon || "").trim();
    if (explicitConnectorId) return getConnectorImageSrc(explicitConnectorId, config);
    return getConnectorImageSrc(nodeRef?.connector, config);
  }

  function ensureConnectorIcon(view, src) {
    if (!src) return null;
    if (ICON_CACHE.has(src)) return ICON_CACHE.get(src);

    const img = new Image();
    img.__failed = false;
    img.onload = () => {
      if (typeof view.requestDraw === "function") view.requestDraw();
      else drawFlowCanvas(view);
    };
    img.onerror = () => {
      if (!img.__fallbackTried && src !== NOIMAGE_SRC) {
        img.__fallbackTried = true;
        img.src = NOIMAGE_SRC;
        return;
      }
      img.__failed = true;
      if (typeof view.requestDraw === "function") view.requestDraw();
      else drawFlowCanvas(view);
    };
    img.src = src;
    ICON_CACHE.set(src, img);
    return img;
  }

  function normalizedSigmoid(t, k, center) {
    const s = (x) => 1 / (1 + Math.exp(-x));
    const min = s((0 - center) * k);
    const max = s((1 - center) * k);
    const cur = s((t - center) * k);
    const denom = max - min || 1;
    return (cur - min) / denom;
  }

  function buildMergeOrthogonalPoints(from, to, style) {
    const sx = from.x + NODE_W;
    const sy = from.y + NODE_H / 2;
    const tx = to.x;
    const ty = to.y + NODE_H / 2;
    const sourceStub = Math.max(18, Math.min(Number(style.turnOffset) || 32, 32));
    const targetInset = Number(style.targetInset) || 18;
    const routeX = sx + sourceStub;
    const entryX = Math.min(tx - targetInset, tx - 12);
    const points = [{ x: sx, y: sy }, { x: routeX, y: sy }];

    if (ty < sy) {
      points.push({ x: routeX, y: ty });
      points.push({ x: entryX, y: ty });
    } else {
      const detourDepth = Number(style.detourDepth) || 32;
      const detourY = sy + detourDepth;
      points.push({ x: routeX, y: detourY });
      points.push({ x: entryX, y: detourY });
      points.push({ x: entryX, y: ty });
    }

    points.push({ x: tx, y: ty });
    return points;
  }

  function buildBackwardOrthogonalPoints(from, to, style) {
    const sx = from.x + NODE_W;
    const sy = from.y + NODE_H / 2;
    const tx = to.x;
    const ty = to.y + NODE_H / 2;
    const sourceStub = Math.max(24, Number(style.turnOffset) || 56);
    const outerMargin = Math.max(40, Number(style.backwardOuterMargin) || 72);
    const targetInset = Math.max(12, Number(style.targetInset) || 18);
    const detourDepth = Math.max(40, Number(style.detourDepth) || 64);
    const routeX = Math.max(sx + sourceStub, Math.max(from.x + NODE_W, to.x + NODE_W) + outerMargin);
    const entryX = Math.min(tx - targetInset, tx - 12);
    const dy = ty - sy;
    const minVerticalClearance = Math.max(18, Math.floor(NODE_H * 0.35));
    let laneY;
    if (Math.abs(dy) <= detourDepth) {
      // 同一段/近傍段は外側へ逃がしてノード干渉を避ける
      laneY = dy >= 0 ? ty + detourDepth : ty - detourDepth;
    } else if (dy > 0) {
      // target が下なら、まず中間レーン（target の上側）を試す
      const middleLane = ty - detourDepth;
      laneY = (middleLane - sy >= minVerticalClearance) ? middleLane : (ty + detourDepth);
    } else {
      // target が上なら、まず中間レーン（target の下側）を試す
      const middleLane = ty + detourDepth;
      laneY = (sy - middleLane >= minVerticalClearance) ? middleLane : (ty - detourDepth);
    }
    laneY = Math.round(laneY);
    return [
      { x: sx, y: sy },
      { x: routeX, y: sy },
      { x: routeX, y: laneY },
      { x: entryX, y: laneY },
      { x: entryX, y: ty },
      { x: tx, y: ty }
    ];
  }

  function drawOrthogonalEdge(ctx, points, style) {
    if (!Array.isArray(points) || points.length < 2) return;
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const cornerRadius = Math.max(0, Number(style.cornerRadius) || 0);

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (cornerRadius <= 0 || points.length < 3) {
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    } else {
      for (let i = 1; i < points.length - 1; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const v1x = p1.x - p0.x;
        const v1y = p1.y - p0.y;
        const v2x = p2.x - p1.x;
        const v2y = p2.y - p1.y;
        const len1 = Math.hypot(v1x, v1y);
        const len2 = Math.hypot(v2x, v2y);
        if (len1 < 0.001 || len2 < 0.001) {
          ctx.lineTo(p1.x, p1.y);
          continue;
        }
        const unit1x = v1x / len1;
        const unit1y = v1y / len1;
        const unit2x = v2x / len2;
        const unit2y = v2y / len2;
        const r = Math.min(cornerRadius, len1 / 2, len2 / 2);
        const startX = p1.x - unit1x * r;
        const startY = p1.y - unit1y * r;
        const endX = p1.x + unit2x * r;
        const endY = p1.y + unit2y * r;
        ctx.lineTo(startX, startY);
        ctx.quadraticCurveTo(p1.x, p1.y, endX, endY);
      }
      ctx.lineTo(last.x, last.y);
    }
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);

    if (style.arrow) {
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      drawArrowHead(ctx, last.x, last.y, angle, style.arrowSize || 6, style.color);
    }
  }

  function drawEdge(ctx, from, to, style) {
    const sx = from.x + NODE_W;
    const sy = from.y + NODE_H / 2;
    const tx = to.x;
    const ty = to.y + NODE_H / 2;

    if (style.mode === "merge_orthogonal") {
      const points = buildMergeOrthogonalPoints(from, to, style);
      drawOrthogonalEdge(ctx, points, style);
      return;
    }

    // x同値/逆向きは、開始方向を右向きで固定した直交ルートで描く
    if (tx <= sx + 1) {
      const points = buildBackwardOrthogonalPoints(from, to, style);
      drawOrthogonalEdge(ctx, points, { ...style, cornerRadius: Math.max(0, Number(style.backwardCornerRadius) || 10) });
      return;
    }

    const totalDx = Math.max(1, tx - sx);
    const preferredStub = Math.max(6, Number(style.endpointStub) || 11);
    const maxStub = Math.max(2, Math.floor((totalDx - 2) / 2));
    const stub = Math.min(preferredStub, maxStub);
    const startStubX = sx + stub;
    const endStubX = tx - stub;
    const middleSpan = Math.max(0, endStubX - startStubX);
    const prevX = endStubX;
    const prevY = ty;

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(startStubX, sy);
    if (middleSpan > 0.5) {
      // スタブ接続は水平接線を維持しつつ、2段cubicで曲率変化をなめらかにする
      const midX = (startStubX + endStubX) / 2;
      const midY = (sy + ty) / 2;
      const a = Math.max(2, Math.min(8, middleSpan * 0.25));
      const b = Math.max(2, Math.min(10, middleSpan * 0.18));
      ctx.bezierCurveTo(startStubX + a, sy, midX - b, sy, midX, midY);
      ctx.bezierCurveTo(midX + b, ty, endStubX - a, ty, endStubX, ty);
    } else {
      ctx.lineTo(endStubX, ty);
    }
    ctx.lineTo(tx, ty);

    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);
    if (style.arrow) {
      const angle = Math.atan2(ty - prevY, tx - prevX);
      drawArrowHead(ctx, tx, ty, angle, style.arrowSize || 6, style.color);
    }
  }

  function drawDraggedNodePreview(ctx, view, model) {
    const dragState = view.dragState;
    if (!dragState || !dragState.started) return;
    const rootStyles = getComputedStyle(document.documentElement);
    const surfacePage = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    const surfaceStrong = rootStyles.getPropertyValue("--surface-strong").trim() || "#4b4e63";
    const dragPreviewStroke = rootStyles.getPropertyValue("--flow-drag-preview-stroke").trim() || "#4b4e63";
    const shadowSoft = rootStyles.getPropertyValue("--alpha-shadow-12").trim() || "rgba(0, 0, 0, 0.12)";
    const previewNodes = Array.isArray(dragState.previewNodes) && dragState.previewNodes.length
      ? dragState.previewNodes
      : [{ nodeId: dragState.nodeId, x: Math.round(dragState.canvasX - NODE_W / 2), y: Math.round(dragState.canvasY - NODE_H / 2) }];

    previewNodes.forEach((preview) => {
      const draggedView = model.nodeMap.get(preview.nodeId);
      if (!draggedView || !draggedView.nodeRef) return;
      const x = Math.round(preview.x);
      const y = Math.round(preview.y);
      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = surfacePage;
      ctx.strokeStyle = dragPreviewStroke;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.shadowColor = shadowSoft;
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 3;
      drawRoundedRect(ctx, x, y, NODE_W, NODE_H, 8);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = surfaceStrong;
      ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(draggedView.nodeRef.stepName || ""), x + NODE_W / 2, y + NODE_H / 2);
      ctx.restore();
    });
  }

  function drawFlowCanvas(view) {
    const runtime = view.root.__flowRuntime;
    if (!runtime) return;

    const { model, state, config } = runtime;
    const { canvas, ctx } = view;
    const rawDpr = window.devicePixelRatio || 1;
    const dpr = Math.max(1, Math.ceil(rawDpr));
    canvas.width = Math.floor(model.width * dpr);
    canvas.height = Math.floor(model.height * dpr);
    canvas.style.width = `${model.width}px`;
    canvas.style.height = `${model.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.clearRect(0, 0, model.width, model.height);

    const rootStyles = getComputedStyle(document.documentElement);
    const warningAccent = rootStyles.getPropertyValue("--semantic-error-fg").trim() || "#9e1f5f";
    const warningText = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    const flowEdgeUnified = "#d4dae4";
    const flowEdgeWidthUnified = 2;
    const flowSelectedNodeAccent = "#5e1ef6";
    const flowSelectedEdgeAccent = "#4c4f64";
    const flowNodeBorder = rootStyles.getPropertyValue("--flow-node-border").trim() || "#9aa5b6";
    const flowNodeStatusRunning = "#5e1ef6";
    const flowNodeStatusError = "#ef475a";
    const flowNodeShadow = rootStyles.getPropertyValue("--flow-node-shadow").trim()
      || rootStyles.getPropertyValue("--alpha-shadow-10").trim()
      || "rgba(79, 67, 67, 0.68)";
    const flowControlFillActive = rootStyles.getPropertyValue("--flow-control-fill-active").trim() || "#4b4e63";
    const flowControlStroke = rootStyles.getPropertyValue("--flow-control-stroke").trim() || "#bdbdbd";
    const flowControlStrokeActive = rootStyles.getPropertyValue("--flow-control-stroke-active").trim() || "#4b4e63";
    const flowControlText = rootStyles.getPropertyValue("--flow-control-text").trim() || "#4b4e63";
    const flowControlTextActive = rootStyles.getPropertyValue("--flow-control-text-active").trim() || "#fffefe";
    const surfaceStrong = rootStyles.getPropertyValue("--surface-strong").trim() || "#4b4e63";
    const surfacePage = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    const surfacePseudo = rootStyles.getPropertyValue("--border-grid-flow").trim() || "#e8eaf2";
    const textMuted = rootStyles.getPropertyValue("--text-muted").trim() || "#767b93";
    const textPrimary = rootStyles.getPropertyValue("--text-primary").trim() || "#4b4e63";
    const pseudoNodeBorder = rootStyles.getPropertyValue("--border-grid").trim() || "#e1e3ec";
    const flowStepBadgeBorder = rootStyles.getPropertyValue("--flow-step-badge-border").trim() || "#c8cad8";
    const stickyNoteMode = !!view.stickyNoteMode;
    const stickyNotes = resolveRenderedStickyNotes(view, model);
    const stickyNoteSelectedId = String(view.stickyNoteSelectedId || "");
    const selectedNodeIds = Array.isArray(state?.selectedNodeIds)
      ? state.selectedNodeIds.map((nodeId) => String(nodeId || "").trim()).filter(Boolean)
      : (state?.selectedNodeId ? [String(state.selectedNodeId)] : []);
    const selectedNodeIdSet = new Set(selectedNodeIds);

    if (!stickyNoteMode) {
      drawStickyNotes(ctx, stickyNotes, { mode: "normal", selectedId: "", editable: false, view });
    }

    const drawModelEdge = ({ edge, from, to, isSelectedEdge }) => {
      if (edge.kind === "to-end" || edge.kind === "to-end-main") return;
      drawEdge(ctx, from, to, {
        color: isSelectedEdge ? flowSelectedEdgeAccent : flowEdgeUnified,
        width: flowEdgeWidthUnified,
        dash: [],
        mode: edge.kind === "parallel" ? "parallel_branch" : "horizontal",
        sigmoidBias: edge.kind === "parallel" ? 0.88 : 0.92,
        sigmoidK: edge.kind === "parallel" ? 10 : 12,
        arrow: true,
        arrowSize: edge.kind === "parallel" ? 6 : edge.kind === "to-end" ? 6 : 7,
        turnOffset: 56,
        targetInset: 0,
        detourDepth: 0,
        backwardCornerRadius: 10
      });
    };

    const edgeDrawList = [];
    model.edges.forEach((edge) => {
      const from = model.nodeMap.get(edge.from);
      const to = model.nodeMap.get(edge.to);
      if (!from || !to) return;
      const isSelectedEdge = selectedNodeIdSet.has(edge.from) || selectedNodeIdSet.has(edge.to);
      edgeDrawList.push({ edge, from, to, isSelectedEdge });
    });

    edgeDrawList.filter((item) => !item.isSelectedEdge).forEach(drawModelEdge);
    edgeDrawList.filter((item) => item.isSelectedEdge).forEach(drawModelEdge);

    if (view.mergeDragState?.sourceId) {
      const sourceNode = model.nodeMap.get(view.mergeDragState.sourceId);
      if (sourceNode) {
        const isSelectedEdge = selectedNodeIdSet.has(view.mergeDragState.sourceId);
        const targetNode = view.mergeDragState.targetNodeId ? model.nodeMap.get(view.mergeDragState.targetNodeId) : null;
        const previewTo = targetNode || {
          x: Math.max(sourceNode.x + NODE_W + 18, view.mergeDragState.canvasX || sourceNode.x + NODE_W + 18),
          y: (view.mergeDragState.canvasY || (sourceNode.y + NODE_H / 2)) - NODE_H / 2
        };
        drawEdge(ctx, sourceNode, previewTo, {
          color: isSelectedEdge ? flowSelectedEdgeAccent : flowEdgeUnified,
          width: flowEdgeWidthUnified,
          dash: [],
          mode: "horizontal",
          arrow: false,
          turnOffset: 56,
          targetInset: 0,
          detourDepth: 0
        });
      }
    }

    const alertNodeIds = new Set(
      model.taskViews
        .filter((taskView) =>
          hasMissingRequiredField(config, taskView.nodeRef) ||
          hasInvalidUpstreamReference(config, state, taskView.nodeRef)
        )
        .map((taskView) => taskView.id)
    );

    const nodesToDraw = [model.start, ...model.taskViews, ...(model.loopEndViews || [])];
    let hasRunningAnimation = false;
    const draggingNodeIdSet = new Set((view.dragState && Array.isArray(view.dragState.nodeIds))
      ? view.dragState.nodeIds
      : (view.dragState?.nodeId ? [view.dragState.nodeId] : []));
    nodesToDraw.forEach((node) => {
      const isStart = node.kind === "start";
      const isEnd = node.kind === "end";
      const isTask = node.kind === "task";
      const isLoopEnd = node.kind === "loop-end";
      const isSelected = (isTask || isStart) && selectedNodeIdSet.has(node.id);
      const isDraggingNode = !!(view.dragState && view.dragState.started && draggingNodeIdSet.has(node.id));
      const hasAlert = isTask && alertNodeIds.has(node.id);
      const stepStatus = isTask ? String((state.stepStatuses && state.stepStatuses[node.nodeRef.stepName]) || "") : "";
      if (stepStatus === "running") hasRunningAnimation = true;
      const statusStrokeColor =
        stepStatus === "running" ? flowNodeStatusRunning :
        stepStatus === "error" ? flowNodeStatusError : "";
      const statusStrokeWidth =
        stepStatus === "running" || stepStatus === "error" ? 3.4 : 0;
      const pseudoNodeInset = isStart || isEnd ? 9 : 0;
      const drawX = node.x + pseudoNodeInset;
      const drawY = node.y + pseudoNodeInset;
      const drawW = NODE_W - pseudoNodeInset * 2;
      const drawH = NODE_H - pseudoNodeInset * 2;
      const animationNow = typeof view.animationNow === "number" ? view.animationNow : performance.now();

      if (isTask && stepStatus === "running") {
        drawRunningOrbit(ctx, node, flowNodeStatusRunning, animationNow);
      }

      ctx.setLineDash([]);
      ctx.fillStyle = isStart || isEnd ? surfacePseudo : surfacePage;
      ctx.globalAlpha = isDraggingNode ? 0.28 : 1;
      ctx.shadowColor = flowNodeShadow;
      ctx.shadowBlur = isStart || isEnd ? 2 : isSelected ? 7 : 5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = isStart || isEnd ? 1 : 2;
      ctx.strokeStyle = isSelected
        ? flowSelectedNodeAccent
        : isStart || isEnd
          ? pseudoNodeBorder
          : statusStrokeColor || flowNodeBorder;
      ctx.lineWidth = isStart || isEnd
        ? (isSelected ? 3.4 : 1.4)
        : Math.max(statusStrokeWidth, isSelected ? 3.4 : 1.4);
      if (isStart) drawOneSideRoundedRect(ctx, drawX, drawY, drawW, drawH, "left");
      else if (isEnd) drawOneSideRoundedRect(ctx, drawX, drawY, drawW, drawH, "right");
      else drawRoundedRect(ctx, node.x, node.y, NODE_W, NODE_H, 8);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.globalAlpha = 1;

      if (isTask) {
        const badgeText = String(node.nodeRef.stepName || "");
        ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        const tw = Math.ceil(ctx.measureText(badgeText).width);
        const bw = Math.max(36, tw + 12);
        const bh = 16;
        const bx = Math.round(node.x + (NODE_W - bw) / 2);
        const by = Math.round(node.y - Math.floor(bh / 2));
        ctx.fillStyle = surfacePage;
        ctx.strokeStyle = flowStepBadgeBorder;
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, bx, by, bw, bh, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = textMuted;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeText, bx + bw / 2, by + bh / 2);
        ctx.textBaseline = "alphabetic";
      }

      if (hasAlert) {
        const markerX = node.x + NODE_W - 2;
        const markerY = node.y + 4;
        ctx.fillStyle = warningAccent;
        ctx.beginPath();
        ctx.arc(markerX, markerY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = warningText;
        ctx.font = "700 11px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", markerX, markerY + 0.5);
        ctx.textBaseline = "alphabetic";
      }

      const iconSrc = isTask ? getConnectorIconSrc(node.nodeRef, config) : null;
      const icon = iconSrc ? ensureConnectorIcon(view, iconSrc) : null;
      const hasIcon = !!(icon && !icon.__failed && icon.complete && icon.naturalWidth > 0);

      ctx.fillStyle = isStart || isEnd ? surfacePage : surfaceStrong;
      ctx.font = isStart || isEnd
        ? "700 12px 'Segoe UI', 'Yu Gothic UI', sans-serif"
        : "700 15px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "center";
      if (isStart) {
        const cx = drawX + drawW / 2;
        const cy = drawY + drawH / 2;
        ctx.strokeStyle = surfaceStrong;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = surfaceStrong;
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy - 5);
        ctx.lineTo(cx - 3, cy + 5);
        ctx.lineTo(cx + 5, cy);
        ctx.closePath();
        ctx.fill();
      } else if (isLoopEnd) {
        ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(node.text, node.x + NODE_W / 2, node.y + NODE_H / 2);
        ctx.textBaseline = "alphabetic";
      } else if (isTask && !hasIcon) {
        ctx.fillText(node.nodeRef.stepName, node.x + NODE_W / 2, node.y + 32);
      }

      if (isTask && hasIcon) {
        const ratio = Math.min((NODE_W - 28) / icon.naturalWidth, (NODE_H - 28) / icon.naturalHeight) * 1.15;
        const w = Math.max(1, Math.floor(icon.naturalWidth * ratio));
        const h = Math.max(1, Math.floor(icon.naturalHeight * ratio));
        const x = Math.round(node.x + (NODE_W - w) / 2);
        const y = Math.round(node.y + (NODE_H - h) / 2);
        ctx.drawImage(icon, x, y, w, h);
      } else if (isTask) {
        ctx.font = "14px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        const lines = [...wrapText(ctx, node.title, NODE_W - 16), ...wrapText(ctx, node.subtitle, NODE_W - 16)].slice(0, 2);
        lines.forEach((line, idx) => ctx.fillText(line, node.x + NODE_W / 2, node.y + 56 + idx * 18));
      }

      if (isTask && String(node.description || "").trim()) {
        ctx.fillStyle = textPrimary;
        ctx.font = "12px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        wrapText(ctx, node.description, NODE_W + 40).forEach((line, idx) => {
          ctx.fillText(line, node.x + NODE_W / 2, node.y + NODE_H + 6 + idx * 14);
        });
        ctx.textBaseline = "alphabetic";
      }
    });

    if (stickyNoteMode) {
      drawStickyNotes(ctx, stickyNotes, { mode: "sticky", selectedId: stickyNoteSelectedId, editable: true, view });
    }

    drawDraggedNodePreview(ctx, view, model);

    const selectionRect = view.rangeSelectionRect;
    if (selectionRect) {
      const x = Math.min(selectionRect.startX, selectionRect.endX);
      const y = Math.min(selectionRect.startY, selectionRect.endY);
      const w = Math.abs(selectionRect.endX - selectionRect.startX);
      const h = Math.abs(selectionRect.endY - selectionRect.startY);
      if (w > 0 && h > 0) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = flowSelectedNodeAccent;
        ctx.fillStyle = "rgba(83,50,247,0.12)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }
    }

    view.hasRunningAnimation = hasRunningAnimation;
  }

  nodeCanvasParts.drawFlowCanvas = drawFlowCanvas;
})();
