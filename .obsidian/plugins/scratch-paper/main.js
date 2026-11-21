const { Notice, Plugin, Scope, setIcon } = require("obsidian");

const DRAFT_KEY = "scratch-paper.text";
const EDGE_MARGIN = 12;
const TEXT_SHORTCUTS = new Set(["a", "c", "v", "x", "z", "backspace", "delete"]);

class ScratchPaperPlugin extends Plugin {
  onload() {
    const saved = this.app.loadLocalStorage(DRAFT_KEY);
    this.text = this.savedText = typeof saved === "string" ? saved : "";

    this.addCommand({
      id: "toggle",
      name: "打开或收起",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "Y" }],
      callback: () => this.toggle(),
    });

    this.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, closedWindow) => {
      if (this.panelWindow === closedWindow) this.removePanel();
    }));
  }

  toggle() {
    const doc = activeDocument;
    if (this.panel?.ownerDocument !== doc) {
      this.removePanel();
      this.createPanel(doc);
    }
    if (!this.panel.hidden) {
      this.hide();
      return;
    }

    this.previousFocus = doc.activeElement;
    this.panel.hidden = false;
    this.keepInView();
    this.panelWindow.addEventListener("resize", this.keepInView);
    this.editor.focus({ preventScroll: true });
  }

  createPanel(doc) {
    this.panelWindow = doc.defaultView;
    const panel = this.panel = doc.body.createEl("section", {
      cls: "scratch-paper",
      attr: { "aria-label": "草稿纸", hidden: "" },
    });
    const header = panel.createDiv({ cls: "scratch-paper__header" });
    const close = header.createEl("button", {
      cls: "scratch-paper__close",
      attr: { type: "button", "aria-label": "收起草稿纸", title: "收起草稿纸" },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.hide());

    this.editor = panel.createEl("textarea", {
      cls: "scratch-paper__editor",
      attr: { "aria-label": "草稿内容", spellcheck: "false" },
    });
    this.editor.value = this.text;
    this.editor.addEventListener("input", () => this.saveDraft());
    this.editorScope = new Scope(this.app.scope);
    this.editorScope.register(null, null, (event) => {
      // Keep native text editing keys out of Obsidian's app-wide shortcuts.
      if (event.isComposing || event.key === "Escape") return true;
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (TEXT_SHORTCUTS.has(key) || (key === "y" && !event.shiftKey)) return true;
    });
    this.editor.addEventListener("focus", () => this.app.keymap.pushScope(this.editorScope));
    this.editor.addEventListener("blur", () => this.app.keymap.popScope(this.editorScope));
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      this.hide();
    });
    this.enableDrag(header);
  }

  saveDraft() {
    this.text = this.editor.value;
    if (this.text !== this.savedText) {
      this.app.saveLocalStorage(DRAFT_KEY, this.text || null);
      if ((this.app.loadLocalStorage(DRAFT_KEY) ?? "") !== this.text) {
        this.saveWarning ??= new Notice("草稿保存失败，当前窗口仍保留文字。", 0);
        return;
      }
      this.savedText = this.text;
    }
    this.saveWarning?.hide();
    this.saveWarning = null;
  }

  enableDrag(header) {
    let drag;
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || drag || event.target.closest("button")) return;
      const { left, top } = this.panel.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX - left, y: event.clientY - top };
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener("pointermove", (event) => {
      if (drag?.id !== event.pointerId) return;
      this.position = { x: event.clientX - drag.x, y: event.clientY - drag.y };
      this.keepInView();
    });
    header.addEventListener("lostpointercapture", () => { drag = null; });
  }

  keepInView = () => {
    if (!this.position) return;
    const { innerWidth, innerHeight } = this.panelWindow;
    const { offsetWidth, offsetHeight, style } = this.panel;
    const x = Math.max(EDGE_MARGIN, Math.min(this.position.x, innerWidth - offsetWidth - EDGE_MARGIN));
    const y = Math.max(EDGE_MARGIN, Math.min(this.position.y, innerHeight - offsetHeight - EDGE_MARGIN));
    style.left = `${x}px`;
    style.top = `${y}px`;
    style.right = "auto";
    style.bottom = "auto";
  };

  hide() {
    if (!this.panel || this.panel.hidden) return;
    this.saveDraft();
    const restoreFocus = this.panel.contains(this.panel.ownerDocument.activeElement);
    this.panel.hidden = true;
    this.app.keymap.popScope(this.editorScope);
    this.panelWindow.removeEventListener("resize", this.keepInView);
    if (restoreFocus && this.previousFocus?.isConnected) {
      this.previousFocus.focus({ preventScroll: true });
    }
    this.previousFocus = null;
  }

  removePanel() {
    this.hide();
    this.panel?.remove();
    this.panel = this.editor = this.editorScope = this.panelWindow = null;
  }

  onunload() {
    this.removePanel();
    this.saveWarning?.hide();
  }
}

module.exports = ScratchPaperPlugin;
