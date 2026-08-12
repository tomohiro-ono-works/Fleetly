(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__classicWorkflowDesignerModules =
    packages.__classicWorkflowDesignerModules || {};

  function cssValue(styles, name, fallback) {
    return styles.getPropertyValue(name).trim() || fallback;
  }

  function resolvePalette(element) {
    const styles = root.getComputedStyle(element);
    return {
      canvas: cssValue(styles, "--flow-canvas-bg", "#ffffff"),
      edge: cssValue(styles, "--flow-edge-main", "#d4dae4"),
      edgeSelected: cssValue(styles, "--surface-strong", "#4b4e63"),
      node: cssValue(styles, "--surface-page", "#ffffff"),
      nodeBorder: cssValue(styles, "--flow-node-border", "#9aa5b6"),
      selected: cssValue(styles, "--brand-700", "#5e1ef6"),
      pseudo: cssValue(styles, "--border-grid-flow", "#e8eaf2"),
      pseudoBorder: cssValue(styles, "--border-grid", "#e1e3ec"),
      text: cssValue(styles, "--text-primary", "#4b4e63"),
      textMuted: cssValue(styles, "--text-muted", "#767b93"),
      badgeBorder: cssValue(styles, "--flow-step-badge-border", "#c8cad8"),
      loop: cssValue(styles, "--flow-loop-frame-stroke", "#805ad5"),
      loopFill: cssValue(styles, "--brand-100", "#eee8ff"),
      running: cssValue(styles, "--semantic-info-fg", "#2563eb"),
      success: cssValue(styles, "--semantic-success-fg", "#159570"),
      error: cssValue(styles, "--semantic-error-fg", "#ef475a"),
      warning: cssValue(styles, "--semantic-warning-fg", "#b76a00"),
      shadow: cssValue(styles, "--flow-node-shadow", "rgba(25, 28, 42, 0.18)"),
      link: cssValue(styles, "--interactive-link", "#1a5fd0")
    };
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const value = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + value, y);
    ctx.lineTo(x + width - value, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + value);
    ctx.lineTo(x + width, y + height - value);
    ctx.quadraticCurveTo(
      x + width,
      y + height,
      x + width - value,
      y + height
    );
    ctx.lineTo(x + value, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - value);
    ctx.lineTo(x, y + value);
    ctx.quadraticCurveTo(x, y, x + value, y);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxWidth, maxLines = 2) {
    const lines = [];
    String(text || "").split(/\r?\n/).forEach((segment) => {
      if (!segment) {
        lines.push("");
        return;
      }
      let line = "";
      Array.from(segment).forEach((character) => {
        const candidate = line + character;
        if (line && ctx.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = character;
        } else {
          line = candidate;
        }
      });
      lines.push(line);
    });
    if (lines.length <= maxLines) return lines;
    const output = lines.slice(0, maxLines);
    const last = output.length - 1;
    output[last] = `${output[last].slice(0, -1)}...`;
    return output;
  }

  function drawArrow(ctx, start, end, color) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = 7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(
      end.x - size * Math.cos(angle - Math.PI / 6),
      end.y - size * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      end.x - size * Math.cos(angle + Math.PI / 6),
      end.y - size * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  function drawEdges(ctx, model, options) {
    const selected = new Set(
      options.selection.edges.map(options.core.edgeRefKey)
    );
    model.edges.forEach((edge) => {
      if (edge.points.length < 2) return;
      const color = selected.has(edge.key)
        ? options.palette.edgeSelected
        : options.palette.edge;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = selected.has(edge.key) ? 3 : 2;
      if (edge.kind === "loop" || edge.kind === "loop-back") {
        ctx.setLineDash([6, 5]);
      } else if (edge.kind === "unassigned") {
        ctx.setLineDash([3, 4]);
      }
      ctx.beginPath();
      ctx.moveTo(edge.points[0].x, edge.points[0].y);
      edge.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
      ctx.setLineDash([]);
      drawArrow(
        ctx,
        edge.points[edge.points.length - 2],
        edge.points[edge.points.length - 1],
        color
      );
      ctx.restore();
    });
  }

  function drawLoopFrames(ctx, frames, palette) {
    frames.forEach((frame) => {
      ctx.save();
      ctx.fillStyle = palette.loopFill;
      ctx.globalAlpha = 0.25;
      roundedRect(ctx, frame.x, frame.y, frame.width, frame.height, 10);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.loop;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = palette.loop;
      ctx.font = "700 11px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(
        String(frame.label || frame.ownerId),
        frame.x + 10,
        frame.y + 7
      );
      ctx.restore();
    });
  }

  function drawNotes(ctx, notes, options) {
    const links = [];
    const selected = new Set(options.selection.annotation_ids);
    notes.forEach((source) => {
      const preview = options.notePreview?.noteId === source.noteId
        ? options.notePreview
        : null;
      const note = {
        ...source,
        x: source.x + (preview?.dx || 0),
        y: source.y + (preview?.dy || 0),
        width: preview?.width || source.width,
        height: preview?.height || source.height
      };
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = String(note.note?.color || "#fff4bf");
      roundedRect(ctx, note.x, note.y, note.width, note.height, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (selected.has(note.noteId)) {
        ctx.strokeStyle = options.palette.selected;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = options.palette.text;
      ctx.font = "13px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const text = String(note.note?.text || "");
      const lines = wrapText(ctx, text, note.width - 16, Math.max(
        1,
        Math.floor((note.height - 14) / 17)
      ));
      lines.forEach((line, index) => {
        const x = note.x + 8;
        const y = note.y + 7 + index * 17;
        const isLink = /^https:\/\//.test(String(line).trim());
        ctx.fillStyle = isLink ? options.palette.link : options.palette.text;
        ctx.fillText(line, x, y);
        if (isLink) {
          const width = ctx.measureText(line).width;
          ctx.beginPath();
          ctx.moveTo(x, y + 15);
          ctx.lineTo(x + width, y + 15);
          ctx.strokeStyle = options.palette.link;
          ctx.lineWidth = 1;
          ctx.stroke();
          links.push({
            noteId: note.noteId,
            url: String(line).trim(),
            x,
            y,
            width,
            height: 17
          });
        }
      });
      if (selected.has(note.noteId) && !options.readonly) {
        ctx.fillStyle = options.palette.selected;
        roundedRect(
          ctx,
          note.x + note.width - 14,
          note.y + note.height - 14,
          14,
          14,
          3
        );
        ctx.fill();
      }
      ctx.restore();
    });
    return links;
  }

  modules.resolveClassicPalette = resolvePalette;
  modules.classicRoundedRect = roundedRect;
  modules.classicWrapText = wrapText;
  modules.drawClassicEdges = drawEdges;
  modules.drawClassicLoopFrames = drawLoopFrames;
  modules.drawClassicNotes = drawNotes;
})(window);
