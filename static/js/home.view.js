(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const app = packages.app = packages.app || {};

  function formatTimestamp(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }

  function createItem(item, kind, onAction) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "home-screen__item";
    button.addEventListener("click", () => {
      onAction?.({ type: "open-flow", kind, item });
    });

    const title = document.createElement("div");
    title.className = "home-screen__item-title";
    title.textContent = String(item?.display_name || "");
    button.appendChild(title);

    const hint = document.createElement("div");
    hint.className = "home-screen__item-hint";
    hint.textContent = `(${String(item?.display_hint || "") || "-"})`;
    button.appendChild(hint);

    if (kind === "recent") {
      const timestamp = formatTimestamp(item?.opened_at);
      if (timestamp) {
        const meta = document.createElement("div");
        meta.className = "home-screen__item-meta";
        meta.textContent = `最終利用: ${timestamp}`;
        button.appendChild(meta);
      }
    }
    return button;
  }

  function createSection({
    title,
    items,
    emptyMessage,
    kind,
    onAction
  }) {
    const section = document.createElement("section");
    section.className = "home-screen__section";

    const heading = document.createElement("h2");
    heading.className = "home-screen__section-title";
    heading.textContent = title;
    section.appendChild(heading);

    const body = document.createElement("div");
    body.className = "home-screen__section-body";
    if (!Array.isArray(items) || !items.length) {
      const empty = document.createElement("div");
      empty.className = "home-screen__empty";
      empty.textContent = emptyMessage;
      body.appendChild(empty);
    } else {
      items.forEach((item) => {
        body.appendChild(createItem(item, kind, onAction));
      });
    }
    section.appendChild(body);
    return section;
  }

  function render({ flowRoot, detailRoot, model, onAction }) {
    if (!flowRoot) return;
    if (detailRoot) detailRoot.innerHTML = "";
    flowRoot.innerHTML = "";

    const shell = document.createElement("div");
    shell.className = "home-screen";

    const hero = document.createElement("section");
    hero.className = "home-screen__hero";
    const title = document.createElement("h1");
    title.className = "home-screen__title";
    const titleText = document.createElement("span");
    titleText.textContent = "ziz ai craft";
    const titleIcon = document.createElement("img");
    titleIcon.className = "home-screen__title-icon";
    titleIcon.src = "./icons/ziz.svg";
    titleIcon.alt = "";
    titleIcon.setAttribute("aria-hidden", "true");
    title.appendChild(titleText);
    title.appendChild(titleIcon);

    const subtitle = document.createElement("div");
    subtitle.className = "home-screen__subtitle";
    subtitle.textContent = "自由自在の業務エージェントビルダーツール";
    const divider = document.createElement("div");
    divider.className = "home-screen__divider";
    hero.appendChild(title);
    hero.appendChild(subtitle);
    hero.appendChild(divider);
    shell.appendChild(hero);

    const grid = document.createElement("div");
    grid.className = "home-screen__grid";
    grid.appendChild(createSection({
      title: "最近使ったプロジェクト",
      items: (model?.recentProjects || []).slice(0, 10),
      emptyMessage: "プロジェクトがありません。",
      kind: "recent",
      onAction
    }));
    grid.appendChild(createSection({
      title: "テンプレートから作成する",
      items: model?.templates || [],
      emptyMessage: "ファイルがありません。",
      kind: "template",
      onAction
    }));
    shell.appendChild(grid);
    flowRoot.appendChild(shell);
  }

  app.homeView = Object.freeze({ render });
})(window);
