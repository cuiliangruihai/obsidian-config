const { Plugin, MarkdownView } = require("obsidian");

const MATH_SCALE = "--math-reading-scale";
const DISPLAY_MATH = '.math-block > mjx-container[jax="CHTML"][display="true"]';
const RENDERED_MATH = `:is(.markdown-rendered, .markdown-source-view.mod-cm6.is-live-preview) ${DISPLAY_MATH}`;

function observeDisplayMath(root) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const widths = new Map();
  let frame = null;

  function refresh() {
    frame = null;
    const equations = new Set(root.querySelectorAll(RENDERED_MATH));
    for (const equation of widths.keys()) {
      if (equations.has(equation)) continue;
      resize.unobserve(equation);
      widths.delete(equation);
      equation.style.removeProperty(MATH_SCALE);
    }

    const updates = [];
    for (const equation of equations) {
      if (!widths.has(equation)) {
        widths.set(equation, 0);
        resize.observe(equation);
      }
      const available = widths.get(equation) - 2;
      const formula = equation.querySelector(":scope > mjx-math");
      if (!formula || available <= 0) continue;

      const formulaStyle = win.getComputedStyle(formula);
      const baseSize = parseFloat(win.getComputedStyle(equation).fontSize);
      // Full-width MathJax tables use min-width for the equation and its labels.
      const table = equation.getAttribute("width") === "full" && formula.querySelector('mjx-mtable[width="full"]');
      const renderedWidth = table ? parseFloat(win.getComputedStyle(table).minWidth) : parseFloat(formulaStyle.width);
      const naturalWidth = renderedWidth * baseSize / parseFloat(formulaStyle.fontSize);
      if (!(naturalWidth > 0)) continue;

      const fit = Math.floor(100 * available / naturalWidth) / 100;
      const scale = Math.max(0.75, Math.min(1.9, fit));
      if (equation.style.getPropertyValue(MATH_SCALE) !== String(scale)) updates.push([equation, scale]);
    }
    for (const [equation, scale] of updates) equation.style.setProperty(MATH_SCALE, String(scale));
  }

  function schedule() {
    if (frame === null) frame = win.requestAnimationFrame(refresh);
  }

  const resize = new win.ResizeObserver((entries) => {
    for (const { target, contentRect } of entries) {
      if (!widths.has(target) || widths.get(target) === contentRect.width) continue;
      widths.set(target, contentRect.width);
      schedule();
    }
  });
  const mutations = new win.MutationObserver((changes) => {
    const mathChanged = changes.some(({ target, addedNodes, removedNodes }) =>
      target.closest?.(DISPLAY_MATH) || [...addedNodes, ...removedNodes].some((node) =>
        node.matches?.('mjx-container[display="true"]') || node.querySelector?.(DISPLAY_MATH)
      )
    );
    if (mathChanged) schedule();
  });
  mutations.observe(root, { childList: true, subtree: true });
  doc.fonts.addEventListener("loadingdone", schedule);
  schedule();

  return {
    schedule,
    stop() {
      win.cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      doc.fonts.removeEventListener("loadingdone", schedule);
      for (const equation of widths.keys()) equation.style.removeProperty(MATH_SCALE);
      widths.clear();
    },
  };
}

module.exports = class ClaudeEditorial extends Plugin {
  onload() {
    this.articles = new Map();
    this.mathViews = new Map();
    this.pendingFrame = null;
    this.pendingRefresh = null;
    this.hidden = false;

    this.addCommand({
      id: "toggle-article-rail",
      name: "显示或隐藏文章左栏",
      callback: () => {
        this.hidden = !this.hidden;
        this.sync();
      },
    });

    for (const event of ["layout-change", "active-leaf-change", "file-open", "css-change"]) {
      this.registerEvent(this.app.workspace.on(event, () => this.scheduleRefresh()));
    }
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("editor-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("config-changed", () => this.scheduleRefresh()));
    this.app.workspace.onLayoutReady(() => this.sync());
  }

  scheduleRefresh() {
    clearTimeout(this.pendingRefresh);
    this.pendingRefresh = setTimeout(() => this.sync(), 100);
  }

  sync() {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const visibleViews = new Set();
    const fittingViews = new Set();

    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file) continue;
      const doc = view.containerEl.ownerDocument;
      const style = doc.defaultView.getComputedStyle(doc.body);
      if (style.getPropertyValue("--math-reading-fit").trim() === "1") {
        fittingViews.add(view);
        if (!this.mathViews.has(view)) this.mathViews.set(view, observeDisplayMath(view.contentEl));
        this.mathViews.get(view).schedule();
      }
      const enabled = style.getPropertyValue("--ce-theme-active").trim() === "1";
      if (!enabled || this.hidden) continue;
      // Canvas cards and hover previews keep their original compact layout.
      if (view.containerEl.closest(".markdown-embed, .canvas-node, .popover")) continue;
      visibleViews.add(view);
      let article = this.articles.get(view);
      if (!article) {
        article = this.mount(view);
        this.articles.set(view, article);
      }
      this.refresh(article);
    }

    for (const [view, article] of this.articles) {
      if (!visibleViews.has(view)) {
        this.remove(article);
        this.articles.delete(view);
      }
    }
    for (const [view, math] of this.mathViews) {
      if (fittingViews.has(view)) continue;
      math.stop();
      this.mathViews.delete(view);
    }
    this.schedulePosition();
  }

  mount(view) {
    const content = view.contentEl;
    content.classList.add("ce-article");
    const rail = content.createEl("aside", { cls: "ce-rail", attr: { "aria-label": "文章导航" } });
    content.prepend(rail);
    const title = rail.createEl("button", { cls: "ce-rail-title", attr: { type: "button", "aria-label": "文章标题，双击重命名" } });
    const navLabel = rail.createDiv({ cls: "ce-rail-label", text: "目录" });
    const nav = rail.createEl("nav", { cls: "ce-rail-tree", attr: { "aria-label": "文章目录" } });
    const footer = rail.createDiv({ cls: "ce-rail-footer" });
    const progressRow = footer.createDiv({ cls: "ce-progress-row" });
    const meter = progressRow.createEl("progress", {
      cls: "ce-progress",
      attr: { max: "100", value: "0", "aria-label": "阅读进度" },
    });
    const percentage = progressRow.createEl("span", { cls: "ce-progress-value", text: "0%", attr: { "aria-hidden": "true" } });
    const readingTime = footer.createDiv({ cls: "ce-reading-time" });
    const metadataSlot = rail.createDiv({ cls: "ce-metadata-slot" });
    const mapSlot = rail.createDiv({ cls: "ce-map-slot" });
    const article = { view, content, rail, title, navLabel, metadataSlot, mapSlot, nav, meter, percentage, readingTime, entries: [], signature: "", scroller: null, jumpFrame: null, docked: new Map() };

    article.onScroll = () => this.schedulePosition();
    article.onClick = (event) => {
      const button = event.target.closest("button");
      if (!button || !rail.contains(button)) return;
      if (button === title) {
        article.scroller?.scrollTo({ top: 0 });
        return;
      }
      const entry = article.entries.find((item) => item.button === button);
      if (!entry) return;
      view.setEphemeralState({ line: entry.heading.position.start.line });
      const win = content.ownerDocument.defaultView;
      win.cancelAnimationFrame(article.jumpFrame);
      const path = view.file.path;
      article.jumpFrame = win.requestAnimationFrame(() => {
        article.jumpFrame = null;
        if (view.file?.path !== path || !article.scroller) return;
        if (view.getMode() === "source") {
          const coords = view.editor.coordsAtPos({ line: entry.heading.position.start.line, ch: 0 });
          if (coords) article.scroller.scrollTop += coords.top - article.scroller.getBoundingClientRect().top - 48;
        } else {
          article.scroller.scrollTop = Math.max(0, article.scroller.scrollTop - 40);
        }
        this.schedulePosition();
      });
      this.schedulePosition();
    };
    article.onTitleDoubleClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (view.file) this.app.fileManager.promptForFileRename(view.file);
    };
    title.addEventListener("dblclick", article.onTitleDoubleClick);
    rail.addEventListener("click", article.onClick);
    const win = content.ownerDocument.defaultView;
    article.observer = new win.ResizeObserver(() => {
      this.syncPanels(article);
      this.schedulePosition();
    });
    article.observer.observe(content);
    article.modeObserver = new win.MutationObserver(() => this.scheduleRefresh());
    article.modeObserver.observe(content, { childList: true });
    for (const mode of content.querySelectorAll(":scope > .markdown-source-view, :scope > .markdown-reading-view")) {
      article.modeObserver.observe(mode, { attributes: true, attributeFilter: ["style", "class"] });
    }
    for (const sizer of content.querySelectorAll(".cm-sizer, .markdown-preview-sizer")) {
      article.observer.observe(sizer);
    }
    article.panelObserver = new win.MutationObserver((changes) => {
      const panelChanged = changes.some((change) => [...change.addedNodes, ...change.removedNodes].some((node) =>
        node.nodeType === 1 && (node.matches(".metadata-container, .floating-topic-map") || node.querySelector(".metadata-container, .floating-topic-map"))
      ));
      if (panelChanged) this.scheduleRefresh();
    });
    article.panelObserver.observe(view.containerEl, { childList: true, subtree: true });
    return article;
  }

  refresh(article) {
    const { view } = article;
    const fontSize = this.app.vault.getConfig("baseFontSize") || 20;
    article.content.style.setProperty("--ce-body-size", `${fontSize}px`);
    const headings = this.app.metadataCache.getFileCache(view.file)?.headings || [];
    const signature = JSON.stringify([view.file.path, headings.map((h) => [h.heading, h.level, h.position.start.line])]);
    article.title.textContent = view.file.basename;
    article.title.title = `${view.file.basename}（双击重命名）`;

    if (signature !== article.signature) {
      article.signature = signature;
      article.nav.empty();
      article.entries = [];
      article.navLabel.hidden = !headings.length;
      article.nav.hidden = !headings.length;
      const stack = [];
      for (const heading of headings) {
        while (stack.length && stack.at(-1).heading.level >= heading.level) stack.pop();
        const parent = stack.at(-1);
        const ancestors = parent ? [...parent.ancestors, parent] : [];
        let target = article.nav;
        if (parent) {
          if (!parent.children) {
            parent.children = parent.group.createDiv({ cls: "ce-tree-children" });
            parent.childrenInner = parent.children.createDiv({ cls: "ce-tree-children-inner" });
          }
          target = parent.childrenInner;
        }
        const group = target.createDiv({ cls: "ce-tree-group" });
        const button = group.createEl("button", {
          cls: "ce-tree-link",
          attr: { type: "button", title: heading.heading },
        });
        button.style.setProperty("--ce-depth", String(ancestors.length));
        button.createSpan({ cls: "ce-tree-branch", text: "└", attr: { "aria-hidden": "true" } });
        button.createSpan({ cls: "ce-tree-text", text: heading.heading });
        const entry = { heading, button, group, ancestors, children: null };
        article.entries.push(entry);
        stack.push(entry);
      }
    }

    const scroller = view.getMode() === "preview"
      ? view.previewMode.containerEl.querySelector(".markdown-preview-view") || view.previewMode.containerEl
      : view.contentEl.querySelector(".cm-scroller");
    if (scroller !== article.scroller) {
      article.scroller?.removeEventListener("scroll", article.onScroll);
      if (article.scroller) article.observer.unobserve(article.scroller);
      article.scroller = scroller;
      scroller?.addEventListener("scroll", article.onScroll, { passive: true });
      if (scroller) article.observer.observe(scroller);
    }

    // Read the current buffer in editing mode, including changes awaiting a save.
    const text = view.getViewData().replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
    const han = (text.match(/\p{Script=Han}/gu) || []).length;
    const words = (text.replace(/\p{Script=Han}/gu, " ").match(/[\p{L}\p{N}]+/gu) || []).length;
    const minutes = Math.max(1, Math.ceil(han / 400 + words / 220));
    article.readingTime.textContent = `约 ${minutes} 分钟阅读`;
    this.syncPanels(article);
  }

  syncPanels(article) {
    const { view } = article;
    const maps = this.app.plugins.getPlugin("note-activity")?.floatingTopicMaps;
    if (maps && view.containerEl.isShown() && (article.mapFilePath !== view.file.path || article.mapManager !== maps)) {
      const panel = maps.open(view.leaf, { focus: false });
      if (panel) {
        article.mapFilePath = view.file.path;
        article.mapManager = maps;
      }
    }
    const wide = getComputedStyle(article.rail).display !== "none";
    if (!wide) {
      for (const key of [...article.docked.keys()]) this.restorePanel(article, key);
      return;
    }

    const mode = view.getMode();
    const modeRoot = mode === "preview"
      ? view.previewMode.containerEl
      : view.contentEl.querySelector(":scope > .markdown-source-view");
    const propertiesSetting = this.app.vault.getConfig("propertiesInDocument");
    const showProperties = propertiesSetting !== "hidden" && propertiesSetting !== "source";
    if (!showProperties) this.restorePanel(article, "metadata");
    // Obsidian shares one metadata editor between its source and reading modes.
    const metadata = showProperties && (view.metadataEditor?.containerEl || modeRoot?.querySelector(".metadata-container"));
    this.dockPanel(article, "metadata", metadata, article.metadataSlot, mode);

    const map = view.containerEl.querySelector(".floating-topic-map");
    this.dockPanel(article, "map", map, article.mapSlot);
  }

  dockPanel(article, key, element, slot, mode) {
    const current = article.docked.get(key);
    const metadataHost = key === "metadata" && (mode === "preview"
      ? article.view.previewMode.renderer.header?.el
      : article.content.querySelector(".markdown-source-view .cm-sizer"));
    if (current && current.element === element && element.parentElement === slot) {
      if (metadataHost && current.mode !== mode) {
        metadataHost.insertBefore(current.placeholder, metadataHost.querySelector(":scope > .cm-contentContainer"));
        current.mode = mode;
      }
      return;
    }
    this.restorePanel(article, key);
    if (!element || (key === "map" && !element.isConnected)) return;
    // Keep the native controls and their event handlers, with an exact return point.
    const placeholder = element.ownerDocument.createComment(`claude-editorial-${key}`);
    if (metadataHost) metadataHost.insertBefore(placeholder, metadataHost.querySelector(":scope > .cm-contentContainer"));
    else element.before(placeholder);
    slot.append(element);
    article.docked.set(key, { element, placeholder, mode, slot });
    if (key === "map") {
      const maps = this.app.plugins.getPlugin("note-activity")?.floatingTopicMaps;
      maps?.entries.get(article.view.leaf)?.editor?.fitAll();
    }
  }

  restorePanel(article, key) {
    const panel = article.docked.get(key);
    if (!panel) return;
    // A map closed by its own plugin stays closed.
    if (panel.element.parentElement === panel.slot && panel.placeholder.parentNode) panel.placeholder.replaceWith(panel.element);
    else panel.placeholder.remove();
    article.docked.delete(key);
  }

  schedulePosition() {
    if (this.pendingFrame !== null) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = null;
      for (const article of this.articles.values()) this.updatePosition(article);
    });
  }

  updatePosition(article) {
    const { view, scroller, entries } = article;
    if (!scroller || !scroller.isShown()) return;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    const progress = maxScroll > 1 ? Math.min(100, Math.max(0, Math.round(scroller.scrollTop / maxScroll * 100))) : 0;
    article.meter.value = progress;
    article.percentage.textContent = `${progress}%`;
    let activeIndex = -1;

    let topLine = null;
    if (view.getMode() === "preview") {
      // Obsidian maps the virtualized reading view back to source lines.
      // Counting rendered headings fails after earlier sections leave the DOM.
      topLine = view.previewMode.getScroll();
      const threshold = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.4;
      for (const section of view.previewMode.renderer.sections) {
        const heading = section.el?.querySelector("h1, h2, h3, h4, h5, h6");
        if (!heading?.isConnected || heading.closest(".markdown-embed")) continue;
        if (heading.getBoundingClientRect().top <= threshold) topLine = Math.max(topLine ?? 0, section.start.line);
      }
    } else {
      const bounds = scroller.getBoundingClientRect();
      const textBounds = view.contentEl.querySelector(".cm-content")?.getBoundingClientRect();
      const position = view.editor.posAtCoords((textBounds?.left ?? bounds.left) + 12, bounds.top + scroller.clientHeight * 0.4);
      topLine = position?.line ?? null;
    }
    if (topLine !== null) {
      for (let index = 0; index < entries.length; index++) {
        if (entries[index].heading.position.start.line <= topLine) activeIndex = index;
      }
    }

    if (scroller.scrollTop < 4) activeIndex = entries.length ? 0 : -1;
    if (maxScroll > 1 && progress === 100) activeIndex = entries.length - 1;
    activeIndex = Math.min(activeIndex, entries.length - 1);
    for (let index = 0; index < entries.length; index++) {
      const button = entries[index].button;
      const active = index === activeIndex;
      button.classList.toggle("is-active", active);
      if (entries[index].children) {
        const expanded = active || !!entries[activeIndex]?.ancestors.includes(entries[index]);
        entries[index].group.classList.toggle("is-open", expanded);
        button.setAttribute("aria-expanded", String(expanded));
      }
      if (active) button.setAttribute("aria-current", "location");
      else button.removeAttribute("aria-current");
    }
  }

  remove(article) {
    article.content.ownerDocument.defaultView.cancelAnimationFrame(article.jumpFrame);
    article.scroller?.removeEventListener("scroll", article.onScroll);
    article.rail.removeEventListener("click", article.onClick);
    article.title.removeEventListener("dblclick", article.onTitleDoubleClick);
    article.observer.disconnect();
    article.modeObserver.disconnect();
    article.panelObserver.disconnect();
    for (const key of [...article.docked.keys()]) this.restorePanel(article, key);
    article.rail.remove();
    article.content.classList.remove("ce-article");
    article.content.style.removeProperty("--ce-body-size");
  }

  onunload() {
    clearTimeout(this.pendingRefresh);
    if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
    for (const article of this.articles.values()) this.remove(article);
    this.articles.clear();
    for (const math of this.mathViews.values()) math.stop();
    this.mathViews.clear();
  }
};
