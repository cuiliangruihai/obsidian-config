const { Component, FuzzySuggestModal, ItemView, MarkdownRenderer, Modal, Notice, Platform, Plugin, TFile, TFolder, setIcon, getAllTags } = require("obsidian");

const VIEW_TYPE = "note-activity-view";
const OWNED_VIEW_TYPE = "personal-items-view";
const TODO_VIEW_TYPE = "personal-todo-view";
const TODO_ROOT = "待办事项";
const TODO_LIST_PATH = `${TODO_ROOT}.md`;
const FLASHCARD_VIEW_TYPE = "spaced-repetition-tab-view";
const REVIEW_SCRATCH_PATH = "草稿纸.md";
const VOCABULARY_VIEW_TYPE = "vocabulary-workbench-view";
const VOCABULARY_URL = "http://127.0.0.1:5173";
const WORD_CARD_PALETTE = {
  surface: "--background-primary",
  raised: "--background-secondary",
  ink: "--text-normal",
  muted: "--text-muted",
  line: "--background-modifier-border",
  accent: "--interactive-accent",
  onAccent: "--text-on-accent",
};
const TOPICS_VIEW_TYPE = "knowledge-topics-view";
const LEARNING_VIEW_TYPE = "learning-schedule-view";
const TALK_VIEW_TYPE = "talk-review-view";
const TALK_ID = "O_zcc6Xl12g";
const TALK_ASSETS = `tmp/yt-dlp/talks/${TALK_ID}`;
const TALK_IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const TALK_CHAPTERS = [
  [0, "你敢让 Agent 在你睡觉时合并什么？"],
  [300000, "Dune 如何把审查规则写进框架"],
  [416000, "临时的计时器补丁如何变成惯例"],
  [580000, "让 Agent 操作正在运行的应用"],
  [711000, "验证消耗的 Token 花在哪里"],
  [812000, "合并约 11,000 个 PR 后发生了什么"],
  [911000, "Grok Bot 发布新版本后会发生什么"],
];
const OWNED_ROOT = "What I Own/";
const ACTIVITY_EXCLUDED_ROOTS = [OWNED_ROOT];
const DATA_VERSION = 1;
const OWNED_FOLDERS = {
  Clothes: "衣物",
  Computers: "电脑",
  Electronics: "电子产品",
  Sports: "运动用品",
  Home: "家居用品",
  Food: "食品与饮品",
  "Personal Care": "个人护理",
  Books: "图书",
  Stationery: "文具",
  Tools: "工具",
  Services: "服务与充值",
  Watches: "手表",
};

function dayKey(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDay(day, amount) {
  const [year, month, date] = day.split("-").map(Number);
  return dayKey(new Date(year, month - 1, date + amount, 12).getTime());
}

function fileStats(file) {
  return {
    ctime: Number(file.stat.ctime) || 0,
    mtime: Number(file.stat.mtime) || 0,
    size: Number(file.stat.size) || 0,
  };
}

function isMarkdown(file) {
  return file instanceof TFile && file.extension.toLowerCase() === "md";
}

function isActivityPath(path) {
  return typeof path === "string" && !ACTIVITY_EXCLUDED_ROOTS.some((root) => path.startsWith(root));
}

function isActivityFile(file) {
  return isMarkdown(file) && isActivityPath(file.path);
}

function textProperty(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

function sockPairs(properties) {
  if (textProperty(properties["类别"]) !== "袜子") return null;
  if (Number.isInteger(properties["双数"]) && properties["双数"] > 0) return properties["双数"];
  if (textProperty(properties["单位"]) === "双" && Number.isInteger(properties["数量"]) && properties["数量"] > 0) return properties["数量"];
  const source = [properties["规格"], properties["商品名称"]].map(textProperty).join(" ");
  const match = source.match(/([0-9]+|[一二两三四五六七八九十]+)\s*双\s*装/);
  if (!match) return null;
  const values = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const perPack = Number(match[1]) || values[match[1]];
  const packs = properties["数量"];
  return perPack && Number.isInteger(packs) && packs > 0 ? perPack * packs : null;
}

function ownedItem(file, cache) {
  if (!file.path.startsWith(OWNED_ROOT)) return null;
  const properties = cache?.frontmatter;
  if (typeof properties?.["类型"] !== "string" || !properties["类型"].trim()) return null;

  const relative = file.path.slice(OWNED_ROOT.length);
  const folder = relative.includes("/") ? relative.split("/")[0] : "";
  const group = OWNED_FOLDERS[folder] || properties["类型"].trim();
  const name = textProperty(properties["名称"]) || textProperty(properties["商品名称"]) || file.basename;
  const category = textProperty(properties["类别"]);
  const details = ["类别", "品牌", "型号", "颜色", "尺码"]
    .map((key) => textProperty(properties[key]))
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const specification = textProperty(properties["规格"]);
  const status = textProperty(properties["状态"]);
  const imageLinks = (cache.embeds || [])
    .map((embed) => embed.link)
    .filter((link) => typeof link === "string" && /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(link.split("#")[0]));

  return {
    file,
    group,
    name,
    category,
    pairs: sockPairs(properties),
    details,
    specification,
    status,
    location: textProperty(properties["位置"]),
    imageLinks,
    searchText: [file.basename, name, group, properties["类型"], ...details, specification].join(" ").toLocaleLowerCase(),
  };
}

function clothingCategories(items) {
  const categories = new Set(items.filter((item) => item.group === "衣物").map((item) => item.category || "未分类"));
  return [...categories].sort((a, b) => {
    if (a === "未分类") return b === "未分类" ? 0 : 1;
    if (b === "未分类") return -1;
    return a.localeCompare(b, "zh-CN");
  });
}

function filterOwnedItems(items, group, query, clothingCategory = null) {
  const term = query.trim().toLocaleLowerCase();
  return items.filter((item) => (group === "全部" || item.group === group) &&
    (group !== "衣物" || clothingCategory === null || (item.category || "未分类") === clothingCategory) &&
    (!term || item.searchText.includes(term)));
}

async function trashOwnedItem(app, file, expectedPath) {
  if (!isMarkdown(file) || !expectedPath.startsWith(OWNED_ROOT) || file.path !== expectedPath ||
      app.vault.getAbstractFileByPath(expectedPath) !== file) {
    throw new Error("物品笔记已移动或删除，请重新选择。");
  }
  const preference = typeof app.vault.getConfig === "function" ? app.vault.getConfig("trashOption") : null;
  if (preference === "system" || preference === "local") await app.fileManager.trashFile(file);
  else await app.vault.trash(file, true);
}

class DeletePersonalItemModal extends Modal {
  constructor(app, item, onDeleted) {
    super(app);
    this.item = item;
    this.originalPath = item.file.path;
    this.onDeleted = onDeleted;
  }

  onOpen() {
    this.titleEl.setText("删除物品");
    this.modalEl.addClass("personal-items-delete-modal");
    this.contentEl.createEl("p", { cls: "personal-items-delete-question", text: `确定删除“${this.item.name}”吗？` });
    this.contentEl.createEl("p", { cls: "personal-items-delete-path", text: this.originalPath });
    this.contentEl.createEl("p", { cls: "personal-items-delete-hint", text: "笔记将移到回收站，图片会保留。其他笔记中的链接会暂时失效。" });
    const errorEl = this.contentEl.createDiv({ cls: "personal-items-delete-error" });
    errorEl.setAttribute("role", "alert");
    const actions = this.contentEl.createDiv({ cls: "personal-items-delete-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    const confirm = actions.createEl("button", { cls: "personal-items-delete-confirm", text: "删除" });
    cancel.addEventListener("click", () => this.close());
    confirm.addEventListener("click", async () => {
      cancel.disabled = true;
      confirm.disabled = true;
      errorEl.setText("");
      try {
        await trashOwnedItem(this.app, this.item.file, this.originalPath);
      } catch (error) {
        errorEl.setText(error?.message || "删除失败，请重试。");
        cancel.disabled = false;
        confirm.disabled = false;
        return;
      }
      this.close();
      this.onDeleted();
      new Notice("物品笔记已移到回收站");
    });
  }

  onClose() { this.contentEl.empty(); }
}

function addPortalNavigation(parent, plugin, currentView, leaf) {
  parent.addClass("personal-portal-view");
  const navigation = parent.createEl("nav", { cls: "personal-portal-navigation" });
  parent.prepend(navigation);
  navigation.setAttribute("aria-label", "工作台功能");
  for (const [label, viewType] of [["学习日程", LEARNING_VIEW_TYPE], ["笔记动态", VIEW_TYPE], ["知识主题", TOPICS_VIEW_TYPE], ["个人物品", OWNED_VIEW_TYPE], ["词汇内化", VOCABULARY_VIEW_TYPE], ["演讲回看", TALK_VIEW_TYPE], ["待办事项", TODO_VIEW_TYPE]]) {
    const button = navigation.createEl("button", { cls: "personal-portal-tab", text: label });
    button.setAttribute("aria-pressed", String(viewType === currentView));
    if (viewType !== currentView) {
      button.addEventListener("click", () => plugin.switchView(leaf, viewType));
    }
  }
}

class ActivityLedger {
  constructor(stored) {
    const valid = stored && stored.version === DATA_VERSION;
    this.data = valid
      ? stored
      : { version: DATA_VERSION, startedAt: 0, lastScanAt: 0, days: {}, snapshot: {} };
    this.data.days ||= {};
    this.data.snapshot ||= {};
  }

  record(kind, path, timestamp, source) {
    const time = Number(timestamp);
    const date = time > 0 ? dayKey(time) : null;
    if (!date || !path) return;

    const day = (this.data.days[date] ||= { created: {}, modified: {} });
    const entries = (day[kind] ||= {});
    const existing = entries[path];
    if (!existing || time >= existing.time) {
      entries[path] = { time, source };
    }
  }

  reconcile(files, now) {
    const firstRun = !this.data.startedAt;
    const lastScanAt = this.data.lastScanAt || this.data.startedAt || 0;
    if (firstRun) this.data.startedAt = now;

    const nextSnapshot = {};
    for (const file of files) {
      const current = fileStats(file);
      const previous = this.data.snapshot[file.path];
      nextSnapshot[file.path] = current;

      if (firstRun) {
        this.record("created", file.path, current.ctime, "metadata");
        this.record("modified", file.path, current.mtime, "metadata");
      } else if (!previous) {
        if (current.ctime >= lastScanAt) {
          this.record("created", file.path, current.ctime, "metadata");
        }
        if (current.mtime >= lastScanAt) {
          this.record("modified", file.path, current.mtime, "metadata");
        }
      } else if (current.mtime !== previous.mtime || current.size !== previous.size) {
        const time = current.mtime !== previous.mtime && current.mtime > 0 ? current.mtime : now;
        this.record("modified", file.path, time, "metadata");
      }
    }

    this.data.snapshot = nextSnapshot;
    this.data.lastScanAt = now;
  }

  create(file, now) {
    this.record("created", file.path, now, "observed");
    this.data.snapshot[file.path] = fileStats(file);
  }

  modify(file, now) {
    this.record("modified", file.path, now, "observed");
    this.data.snapshot[file.path] = fileStats(file);
  }

  remove(path, folder = false) {
    for (const savedPath of Object.keys(this.data.snapshot)) {
      if (savedPath === path || (folder && savedPath.startsWith(`${path}/`))) {
        delete this.data.snapshot[savedPath];
      }
    }
  }

  rename(oldPath, newPath, folder) {
    const remap = (path) => {
      if (path === oldPath) return newPath;
      if (folder && path.startsWith(`${oldPath}/`)) return `${newPath}${path.slice(oldPath.length)}`;
      return path;
    };
    const moveKeys = (entries) => {
      for (const path of Object.keys(entries)) {
        const target = remap(path);
        if (target === path) continue;
        const previous = entries[target];
        const current = entries[path];
        if (!previous || !previous.time || current.time > previous.time) entries[target] = current;
        delete entries[path];
      }
    };

    moveKeys(this.data.snapshot);
    for (const day of Object.values(this.data.days)) {
      moveKeys(day.created || {});
      moveKeys(day.modified || {});
    }
  }

  entries(date, kind) {
    const entries = this.data.days[date]?.[kind] || {};
    return Object.entries(entries)
      .filter(([path]) => isActivityPath(path))
      .map(([path, detail]) => ({ path, ...detail }))
      .sort((a, b) => b.time - a.time || a.path.localeCompare(b.path, "zh-CN"));
  }
}

class NoteActivityView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedDay = dayKey(Date.now());
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "笔记动态"; }
  getIcon() { return "calendar-days"; }

  async onOpen() { this.render(); }

  setDay(day) {
    if (!day || day > dayKey(Date.now())) return;
    this.selectedDay = day;
    this.render();
  }

  render() {
    if (!this.contentEl || !this.plugin.ledger) return;
    const root = this.contentEl;
    root.empty();
    root.addClass("note-activity-view-content");
    const page = root.createDiv({ cls: "note-activity" });
    addPortalNavigation(this.contentEl, this.plugin, VIEW_TYPE, this.leaf);
    const header = page.createDiv({ cls: "note-activity-header" });
    header.createEl("h1", { text: "笔记动态" });

    const controls = header.createDiv({ cls: "note-activity-controls" });
    this.iconButton(controls, "chevron-left", "前一天", () => this.setDay(shiftDay(this.selectedDay, -1)));
    const dateInput = controls.createEl("input", { cls: "note-activity-date", type: "date" });
    dateInput.setAttribute("aria-label", "选择日期");
    dateInput.max = dayKey(Date.now());
    dateInput.value = this.selectedDay;
    dateInput.addEventListener("change", () => this.setDay(dateInput.value));
    const next = this.iconButton(controls, "chevron-right", "后一天", () => this.setDay(shiftDay(this.selectedDay, 1)));
    next.disabled = this.selectedDay >= dayKey(Date.now());
    const today = controls.createEl("button", { cls: "note-activity-today", text: "今天" });
    today.disabled = this.selectedDay === dayKey(Date.now());
    today.addEventListener("click", () => this.setDay(dayKey(Date.now())));

    this.renderSection(page, "新增", "created");
    this.renderSection(page, "修改", "modified");
    if (this.plugin.ledger.data.startedAt) {
      const started = dayKey(this.plugin.ledger.data.startedAt);
      page.createEl("p", {
        cls: "note-activity-footnote",
        text: `开始记录：${started}。更早及停用期间的数据按文件时间补充，可能不完整。`,
      });
    }
  }

  iconButton(parent, icon, label, action) {
    const button = parent.createEl("button", { cls: "note-activity-icon-button" });
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    setIcon(button, icon);
    button.addEventListener("click", action);
    return button;
  }

  renderSection(parent, title, kind) {
    const entries = this.plugin.ledger.entries(this.selectedDay, kind);
    const section = parent.createEl("section", { cls: "note-activity-section" });
    const heading = section.createDiv({ cls: "note-activity-section-heading" });
    heading.createEl("h2", { text: title });
    heading.createEl("span", { cls: "note-activity-count", text: String(entries.length) });

    if (!entries.length) {
      section.createEl("p", { cls: "note-activity-empty", text: kind === "created" ? "这天没有新增记录" : "这天没有修改记录" });
      return;
    }
    const list = section.createEl("ul", { cls: "note-activity-list" });
    for (const entry of entries) {
      const row = list.createEl("li", { cls: "note-activity-row" });
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      const available = isMarkdown(file);
      const button = row.createEl("button", { cls: "note-activity-note" });
      button.disabled = !available;
      const name = entry.path.split("/").pop().replace(/\.md$/i, "");
      button.createEl("span", { cls: "note-activity-note-name", text: name });
      const folder = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "根目录";
      button.createEl("span", { cls: "note-activity-note-path", text: available ? folder : `${folder}（已删除或移动）` });
      if (available) {
        button.addEventListener("click", () => {
          const current = this.app.vault.getAbstractFileByPath(entry.path);
          if (isMarkdown(current)) this.app.workspace.getLeaf("tab").openFile(current);
          else new Notice("笔记已删除或移动");
        });
      }
      row.createEl("time", {
        cls: "note-activity-time",
        text: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(entry.time)),
      });
    }
  }
}

class PersonalItemsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.group = "全部";
    this.clothingCategory = null;
    this.query = "";
    this.items = [];
    this.refreshTimer = null;
  }

  getViewType() { return OWNED_VIEW_TYPE; }
  getDisplayText() { return "个人物品"; }
  getIcon() { return "package"; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("personal-items-view-content");
    const page = root.createDiv({ cls: "personal-items" });
    addPortalNavigation(this.contentEl, this.plugin, OWNED_VIEW_TYPE, this.leaf);
    const header = page.createDiv({ cls: "personal-items-header" });
    header.createEl("h1", { text: "个人物品" });
    const search = header.createEl("input", {
      cls: "personal-items-search",
      type: "search",
      placeholder: "搜索名称、品牌或规格",
    });
    search.setAttribute("aria-label", "搜索个人物品");
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderItems();
    });
    this.categoryEl = page.createDiv({ cls: "personal-items-categories" });
    this.categoryEl.setAttribute("role", "group");
    this.categoryEl.setAttribute("aria-label", "物品分类");
    this.clothingCategoryEl = page.createDiv({ cls: "personal-items-subcategories" });
    this.clothingCategoryEl.setAttribute("role", "group");
    this.clothingCategoryEl.setAttribute("aria-label", "衣物分类");
    this.countEl = page.createDiv({ cls: "personal-items-count" });
    this.gridEl = page.createDiv({ cls: "personal-items-grid" });

    const relevant = (file, oldPath) => file?.path?.startsWith(OWNED_ROOT) || oldPath?.startsWith(OWNED_ROOT);
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (relevant(file)) this.scheduleRefresh();
    }));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    for (const event of ["create", "delete", "rename"]) {
      this.registerEvent(this.app.vault.on(event, (file, oldPath) => {
        if (relevant(file, oldPath)) this.scheduleRefresh();
      }));
    }
    this.refreshItems();
  }

  async onClose() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
  }

  scheduleRefresh() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshItems();
    }, 150);
  }

  refreshItems() {
    this.items = this.app.vault.getMarkdownFiles()
      .map((file) => ownedItem(file, this.app.metadataCache.getFileCache(file)))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    this.renderCategories();
    this.renderClothingCategories();
    this.renderItems();
  }

  renderCategories() {
    this.categoryEl.empty();
    const groups = [...new Set(this.items.map((item) => item.group))];
    const order = Object.values(OWNED_FOLDERS);
    groups.sort((a, b) => {
      const ai = order.indexOf(a), bi = order.indexOf(b);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b, "zh-CN");
    });
    if (this.group !== "全部" && !groups.includes(this.group)) this.group = "全部";
    for (const group of ["全部", ...groups]) {
      const button = this.categoryEl.createEl("button", { text: group, cls: "personal-items-category" });
      button.setAttribute("aria-pressed", String(group === this.group));
      button.addEventListener("click", () => {
        if (this.group !== group) this.clothingCategory = null;
        this.group = group;
        this.renderCategories();
        this.renderClothingCategories();
        this.renderItems();
      });
    }
  }

  renderClothingCategories() {
    this.clothingCategoryEl.empty();
    const show = this.group === "衣物";
    this.clothingCategoryEl.hidden = !show;
    this.categoryEl.classList.toggle("has-subcategories", show);
    if (!show) {
      this.clothingCategory = null;
      return;
    }

    const categories = clothingCategories(this.items);
    if (this.clothingCategory !== null && !categories.includes(this.clothingCategory)) this.clothingCategory = null;
    for (const category of [null, ...categories]) {
      const button = this.clothingCategoryEl.createEl("button", {
        text: category === null ? "全部衣物" : category,
        cls: "personal-items-subcategory",
      });
      button.setAttribute("aria-pressed", String(category === this.clothingCategory));
      button.addEventListener("click", () => {
        this.clothingCategory = category;
        this.renderClothingCategories();
        this.renderItems();
      });
    }
  }

  renderItems() {
    if (!this.gridEl) return;
    const shown = filterOwnedItems(this.items, this.group, this.query, this.clothingCategory);
    this.countEl.setText(`${shown.length} 条记录`);
    this.gridEl.empty();
    if (!shown.length) {
      this.gridEl.createEl("p", {
        cls: "personal-items-empty",
        text: this.items.length ? "没有找到符合条件的物品" : "还没有已登记的物品",
      });
      return;
    }

    for (const item of shown) {
      const card = this.gridEl.createEl("article", { cls: "personal-items-card" });
      const open = card.createEl("button", { cls: "personal-items-open" });
      open.setAttribute("aria-label", `打开 ${item.name}`);
      const imageBox = open.createDiv({ cls: "personal-items-image" });
      let imageFile = null;
      for (const link of item.imageLinks) {
        const candidate = this.app.metadataCache.getFirstLinkpathDest(link, item.file.path);
        if (candidate instanceof TFile) { imageFile = candidate; break; }
      }
      const showPlaceholder = () => {
        imageBox.empty();
        const placeholder = imageBox.createDiv({ cls: "personal-items-image-placeholder" });
        const icon = placeholder.createEl("span", { cls: "personal-items-image-icon" });
        setIcon(icon, "image");
        placeholder.createEl("span", { text: "暂无图片" });
      };
      if (imageFile) {
        const image = imageBox.createEl("img");
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.addEventListener("error", showPlaceholder, { once: true });
        image.src = this.app.vault.getResourcePath(imageFile);
      } else showPlaceholder();

      const info = open.createDiv({ cls: "personal-items-info" });
      info.createDiv({ cls: "personal-items-name", text: item.name });
      if (item.details.length) {
        const detail = info.createDiv({ cls: "personal-items-detail" });
        for (const value of item.details.slice(0, 3)) detail.createEl("span", { text: value });
      }
      if (item.specification) info.createDiv({ cls: "personal-items-specification", text: item.specification });
      if (item.category === "袜子") info.createDiv({ cls: "personal-items-specification", text: item.pairs === null ? "双数未填写" : `数量：${item.pairs} 双` });
      if (item.status) info.createDiv({ cls: "personal-items-status", text: `状态：${item.status}` });
      open.addEventListener("click", () => {
        const current = this.app.vault.getAbstractFileByPath(item.file.path);
        if (isMarkdown(current)) this.app.workspace.getLeaf("tab").openFile(current);
        else new Notice("物品笔记已删除或移动");
      });
      const location = card.createEl("select", { cls: "personal-items-location" });
      location.setAttribute("aria-label", `${item.name}的位置`);
      const values = ["", "宿舍", "家", "实验室"];
      if (item.location && !values.includes(item.location)) values.push(item.location);
      for (const value of values) {
        const option = location.createEl("option", { text: value || "未设置位置", value });
        option.selected = value === item.location;
      }
      location.addEventListener("change", async () => {
        const value = location.value;
        location.disabled = true;
        try {
          const current = this.app.vault.getAbstractFileByPath(item.file.path);
          if (current !== item.file || !isMarkdown(current) || !current.path.startsWith(OWNED_ROOT)) throw new Error("物品笔记已移动或删除");
          await this.app.fileManager.processFrontMatter(current, (frontmatter) => {
            if (value) frontmatter["位置"] = value;
            else delete frontmatter["位置"];
          });
        } catch (error) {
          new Notice(`保存位置失败：${error.message}`);
          location.value = item.location;
        } finally { location.disabled = false; }
      });
      const remove = card.createEl("button", { cls: "personal-items-delete", title: "删除物品" });
      remove.setAttribute("aria-label", `删除 ${item.name}`);
      setIcon(remove, "trash-2");
      remove.addEventListener("click", () => {
        new DeletePersonalItemModal(this.app, item, () => {
          if (this.gridEl?.isConnected) this.refreshItems();
        }).open();
      });
    }
  }
}

function knowledgeTopics(notes) {
  const topics = new Map();
  for (const note of notes) {
    note.tags = [...new Set(note.tags.map((tag) => tag.replace(/^#/, "")).filter(Boolean))];
    for (const tag of note.tags) {
      if (!topics.has(tag)) topics.set(tag, []);
      topics.get(tag).push(note);
    }
  }
  return new Map([...topics].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "zh-CN")));
}

function topicHierarchy(topics, parents = {}) {
  const nodes = new Map();
  const ensure = (tag) => {
    if (!nodes.has(tag)) nodes.set(tag, { tag, parent: null, children: [], notes: new Set(topics.get(tag) || []) });
    return nodes.get(tag);
  };
  for (const tag of [...topics.keys(), ...Object.keys(parents)]) ensure(tag);
  for (const node of nodes.values()) {
    const parent = Object.hasOwn(parents, node.tag) ? parents[node.tag] : node.tag.includes("/") ? node.tag.slice(0, node.tag.lastIndexOf("/")) : null;
    if (parent !== null && (typeof parent !== "string" || !parent.trim())) throw new Error("上级主题名称无效");
    node.parent = parent;
    if (parent) ensure(parent);
  }
  for (const node of nodes.values()) {
    const seen = new Set([node.tag]);
    let parent = node.parent;
    while (parent) {
      if (seen.has(parent)) throw new Error("主题不能归入自身或自己的子主题");
      seen.add(parent);
      for (const note of node.notes) nodes.get(parent).notes.add(note);
      parent = nodes.get(parent).parent;
    }
    if (node.parent) nodes.get(node.parent).children.push(node);
  }
  return nodes;
}

function topicContains(nodes, parent, tag) {
  let node = nodes.get(tag);
  while (node) {
    if (node.tag === parent) return true;
    node = nodes.get(node.parent);
  }
  return false;
}

function unplannedTopicParents(topics, stored = {}) {
  const parents = { ...stored, 未规划: null };
  const nodes = topicHierarchy(topics, stored);
  for (const node of nodes.values()) {
    if (node.tag !== "未规划" && node.parent === null && !Object.hasOwn(stored, node.tag)) parents[node.tag] = "未规划";
  }
  return parents;
}

function topicGraphLayout(nodes) {
  const positions = new Map();
  const cellWidth = 156;
  const columns = 6;
  const heights = Array(columns).fill(24);
  const sorted = (items) => [...items].sort((a, b) => a.tag.localeCompare(b.tag, "zh-CN"));
  const leaves = (node) => node.children.length ? node.children.reduce((sum, child) => sum + leaves(child), 0) : 1;
  const depth = (node) => node.children.length ? 1 + Math.max(...node.children.map(depth)) : 0;
  let width = columns * cellWidth + 48;
  for (const root of [...nodes.values()].filter((node) => node.parent === null && node.tag !== "未规划").sort((a, b) => b.notes.size - a.notes.size || a.tag.localeCompare(b.tag, "zh-CN"))) {
    const leafCount = leaves(root);
    const span = Math.min(columns, leafCount);
    let column = 0;
    let top = Infinity;
    for (let start = 0; start <= columns - span; start++) {
      const candidate = Math.max(...heights.slice(start, start + span));
      if (candidate < top) { top = candidate; column = start; }
    }
    const left = 24 + column * cellWidth;
    const place = (node, start, level) => {
      const count = leaves(node);
      positions.set(node.tag, { x: left + (start + count / 2) * cellWidth - 66, y: top + level * 100 });
      let next = start;
      for (const child of sorted(node.children)) { place(child, next, level + 1); next += leaves(child); }
    };
    place(root, 0, 0);
    const bottom = top + depth(root) * 100 + 72;
    for (let index = column; index < column + span; index++) heights[index] = bottom;
    width = Math.max(width, left + leafCount * cellWidth + 24);
  }
  let height = Math.max(380, ...heights.map((height) => height + 24));
  if (nodes.has("未规划")) {
    const top = Math.max(...heights) + 24;
    const members = new Map([...nodes].filter(([tag]) => tag !== "未规划" && topicContains(nodes, "未规划", tag))
      .map(([tag, node]) => [tag, { ...node, parent: node.parent === "未规划" ? null : node.parent }]));
    const children = topicGraphLayout(members);
    positions.set("未规划", { x: 24, y: top });
    for (const [tag, point] of children.positions) positions.set(tag, { x: point.x, y: point.y + top + 40 });
    width = Math.max(width, children.width);
    height = Math.max(height, top + children.height + 64);
  }
  return { positions, width, height };
}

function topicNodeTone(count, maximum) {
  if (!count || !maximum) return 0;
  return Math.min(5, Math.max(1, Math.ceil(Math.log1p(count) / Math.log1p(maximum) * 5)));
}

function topicGroupBounds(nodes, positions, group) {
  if (!nodes.has(group)) return null;
  const members = [...positions].filter(([tag]) => topicContains(nodes, group, tag)).map(([, point]) => point);
  return {
    x: Math.min(...members.map((point) => point.x)) - 16,
    y: Math.min(...members.map((point) => point.y)) - 16,
    width: Math.max(...members.map((point) => point.x)) - Math.min(...members.map((point) => point.x)) + 164,
    height: Math.max(...members.map((point) => point.y)) - Math.min(...members.map((point) => point.y)) + 72,
  };
}

function topicDropParent(nodes, positions, source, x, y) {
  for (const [tag, position] of positions) {
    if (tag === "未规划") continue;
    if (x < position.x || x > position.x + 132 || y < position.y || y > position.y + 40) continue;
    return topicContains(nodes, source, tag) ? undefined : tag;
  }
  const bounds = topicGroupBounds(nodes, positions, "未规划");
  if (bounds && x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height) {
    return topicContains(nodes, source, "未规划") ? undefined : "未规划";
  }
  return null;
}

const openingNoteTabs = new WeakMap();

async function openNoteTab(app, file) {
  const workspace = app.workspace;
  const existing = workspace.getLeavesOfType("markdown").find((leaf) =>
    (leaf.view.file?.path ?? leaf.getViewState?.()?.state?.file) === file.path
  );
  if (existing) {
    await workspace.revealLeaf(existing);
    workspace.setActiveLeaf(existing, { focus: true });
    return;
  }
  let requests = openingNoteTabs.get(workspace);
  if (!requests) { requests = new Map(); openingNoteTabs.set(workspace, requests); }
  let opening = requests.get(file.path);
  if (!opening) {
    const leaf = workspace.getLeaf("tab");
    opening = leaf.openFile(file).then(() => leaf);
    requests.set(file.path, opening);
  }
  try {
    const leaf = await opening;
    await workspace.revealLeaf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
  } finally {
    if (requests.get(file.path) === opening) requests.delete(file.path);
  }
}

class TopicNotesModal extends Modal {
  constructor(app, tag, notes) {
    super(app);
    this.tag = tag;
    this.notes = [...notes].sort((a, b) => a.file.basename.localeCompare(b.file.basename, "zh-CN"));
  }

  onOpen() {
    this.titleEl.setText(this.tag);
    this.modalEl.addClass("tag-notes-modal");
    const input = this.contentEl.createEl("input", { type: "search", placeholder: "筛选笔记名称", attr: { "aria-label": "筛选笔记名称" } });
    const list = this.contentEl.createDiv({ cls: "tag-notes-results" });
    const render = () => {
      list.empty();
      const query = input.value.trim().toLocaleLowerCase();
      const notes = this.notes.filter((note) => note.file.basename.toLocaleLowerCase().includes(query));
      for (const note of notes) {
        const link = list.createEl("a", { text: note.file.basename, href: note.file.path });
        const reviewed = this.app.metadataCache?.getFileCache(note.file)?.frontmatter?.human_reviewed === true;
        if (!reviewed) link.createEl("span", { cls: "tag-notes-review-warning", text: "!", attr: { title: "尚未完成人工审核", "aria-label": "尚未完成人工审核", role: "img" } });
        link.addEventListener("click", async (event) => {
          event.preventDefault();
          const file = this.app.vault.getAbstractFileByPath(note.file.path);
          if (!isMarkdown(file)) { new Notice("笔记已移动或删除"); return; }
          await openNoteTab(this.app, file);
          this.close();
        });
      }
      if (!notes.length) list.createEl("p", { cls: "tag-notes-empty", text: query ? "没有匹配的笔记" : "暂无笔记" });
    };
    input.value = "";
    input.addEventListener("input", render);
    render();
  }

  onClose() { this.contentEl.empty(); }
}

class TopicGraphEditor {
  constructor(view, contentEl) {
    this.view = view;
    this.contentEl = contentEl;
    this.parents = Object.assign(Object.create(null), view.parents);
    this.baseParents = { ...view.parents };
    this.history = [];
    this.selectedTag = null;
    this.camera = { x: 24, y: 24, scale: 1 };
  }

  mount() {
    this.contentEl.setAttribute("tabindex", "-1");
    this.onKeyDown = (event) => {
      if (event.key === "Escape" && !this.adding && this.view.closeFloatingMap) {
        event.preventDefault();
        event.stopPropagation();
        this.view.closeFloatingMap();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && event.target.tagName !== "INPUT") {
        event.preventDefault();
        this.undo();
      }
    };
    this.contentEl.addEventListener("keydown", this.onKeyDown);
    this.render(false);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.applyCamera());
      this.resizeObserver.observe(this.contentEl);
    }
  }

  applyCamera() {
    if (!this.world) return;
    if (!this.cameraInitialized && this.viewport.clientWidth && this.viewport.clientHeight) { this.fitAll(); return; }
    const { x, y, scale } = this.camera;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  zoom(factor, x = this.viewport.clientWidth / 2, y = this.viewport.clientHeight / 2) {
    if (this.nodeDrag) return;
    this.camera = learningMapZoom(this.camera, factor, x, y);
    this.cameraInitialized = true;
    this.applyCamera();
  }

  fitAll() {
    if (!this.viewport?.clientWidth || !this.viewport.clientHeight || this.nodeDrag) return;
    const scale = Math.max(0.001, Math.min(1, (this.viewport.clientWidth - 48) / this.layout.width, (this.viewport.clientHeight - 48) / this.layout.height));
    this.camera = { scale, x: (this.viewport.clientWidth - this.layout.width * scale) / 2, y: (this.viewport.clientHeight - this.layout.height * scale) / 2 };
    this.cameraInitialized = true;
    this.applyCamera();
  }

  sync() {
    if (this.saving || this.nodeDrag || this.adding) return;
    if (!this.history.length) {
      this.parents = Object.assign(Object.create(null), this.view.parents);
      this.baseParents = { ...this.view.parents };
    }
    this.render(false);
  }

  iconButton(parent, icon, label, action) {
    const button = parent.createEl("button", { cls: "tag-icon-button", attr: { type: "button", "aria-label": label, title: label } });
    setIcon(button, icon);
    button.addEventListener("click", action);
    return button;
  }

  render(focus = true) {
    this.dragCleanup?.();
    this.nodeDrag = null;
    this.contentEl.empty();
    const nodes = topicHierarchy(this.view.topics, unplannedTopicParents(this.view.topics, this.parents));
    const header = this.contentEl.createDiv({ cls: "tag-graph-header" });
    header.createEl("h1", { text: "标签" });
    const tools = header.createDiv({ cls: "tag-graph-tools" });
    this.iconButton(tools, "scan", "查看全部", () => this.fitAll());
    this.iconButton(tools, "minus", "缩小", () => this.zoom(0.8));
    this.iconButton(tools, "zoom-in", "放大", () => this.zoom(1.25));
    this.iconButton(tools, "plus", "新建标签", () => { this.adding = !this.adding; this.render(); });
    this.iconButton(tools, "undo-2", "撤销", () => this.undo()).disabled = !this.history.length;
    this.saveButton = this.iconButton(tools, "check", "保存", () => this.save());
    this.saveButton.addClass("tag-save");
    this.saveButton.disabled = !this.history.length;
    if (this.view.closeFloatingMap) this.iconButton(tools, "x", "关闭悬浮地图", this.view.closeFloatingMap);
    this.renderGraph(nodes);
    this.applyCamera();
    if (this.adding) {
      const form = this.contentEl.createEl("form", { cls: "tag-name-editor" });
      const input = form.createEl("input", { type: "text", placeholder: "标签名称", attr: { "aria-label": "标签名称" } });
      const submit = form.createEl("button", { attr: { type: "submit", "aria-label": "添加", title: "添加" } });
      setIcon(submit, "arrow-up");
      form.addEventListener("submit", (event) => { event.preventDefault(); this.addTag(input.value); });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { event.stopPropagation(); this.adding = false; this.render(); }
      });
      queueMicrotask(() => input.focus());
    } else if (focus) {
      this.contentEl.focus();
    }
  }

  addTag(value) {
    if (this.saving) return;
    const name = value.trim().replace(/^#/, "");
    if (!name) return;
    if (topicHierarchy(this.view.topics, this.parents).has(name)) { new Notice("标签已存在"); return; }
    this.history.push({ ...this.parents });
    this.parents[name] = null;
    this.adding = false;
    this.selectedTag = name;
    this.render();
  }

  undo() {
    if (this.saving || !this.history.length) return;
    this.parents = Object.assign(Object.create(null), this.history.pop());
    this.selectedTag = null;
    this.render();
  }

  removeGroup(tag) {
    if (this.saving || tag === "未规划" || this.view.topics.has(tag) || !Object.hasOwn(this.parents, tag)) return;
    const node = topicHierarchy(this.view.topics, this.parents).get(tag);
    if (!node) return;
    this.history.push({ ...this.parents });
    for (const child of node.children) this.parents[child.tag] = node.parent;
    delete this.parents[tag];
    this.selectedTag = null;
    this.render();
  }

  async save() {
    if (this.saving || !this.history.length) return;
    this.saving = true;
    for (const element of this.contentEl.querySelectorAll("button, input")) element.disabled = true;
    try {
      const merged = { ...(this.view.plugin.ledger?.data.topicParents ?? this.view.parents) };
      for (const tag of new Set([...Object.keys(this.baseParents), ...Object.keys(this.parents)])) {
        if (Object.hasOwn(this.baseParents, tag) === Object.hasOwn(this.parents, tag) && this.baseParents[tag] === this.parents[tag]) continue;
        if (Object.hasOwn(this.parents, tag)) merged[tag] = this.parents[tag];
        else delete merged[tag];
      }
      topicHierarchy(this.view.topics, merged);
      await this.view.plugin.saveTopicParents(merged);
      this.parents = Object.assign(Object.create(null), merged);
      this.baseParents = { ...merged };
      this.history = [];
      this.saving = false;
      this.render();
    } catch (error) {
      new Notice(`保存失败：${error.message}`);
      this.saving = false;
      this.render();
    }
  }

  moveTag(tag, parent) {
    if (this.saving) return;
    const nodes = topicHierarchy(this.view.topics, this.parents);
    if (!nodes.has(tag) || (parent !== null && !nodes.has(parent))) return;
    if (parent !== null && topicContains(nodes, tag, parent)) { new Notice("不能移到自己或自己的子标签下"); return; }
    if (nodes.get(tag).parent === parent) return;
    this.history.push({ ...this.parents });
    this.parents[tag] = parent;
    this.selectedTag = null;
    this.render();
    return true;
  }

  renderGraph(nodes) {
    const viewport = this.contentEl.createDiv({ cls: "tag-graph-viewport", attr: { tabindex: "0", "aria-label": "标签关系图，拖动空白处平移，滚轮缩放" } });
    this.viewport = viewport;
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      this.zoom(Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.008), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    viewport.addEventListener("keydown", (event) => {
      if (event.target !== viewport) return;
      const moves = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
      if (moves[event.key]) {
        event.preventDefault();
        this.camera.x += moves[event.key][0];
        this.camera.y += moves[event.key][1];
        this.applyCamera();
      } else if (["+", "=", "-"].includes(event.key)) {
        event.preventDefault();
        this.zoom(event.key === "-" ? 0.8 : 1.25);
      }
    });
    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.saving || event.target.closest("button, input")) return;
      const doc = viewport.ownerDocument;
      const start = { x: event.clientX, y: event.clientY, left: this.camera.x, top: this.camera.y };
      this.nodeDrag = { id: event.pointerId, active: false };
      const move = (event) => {
        if (this.nodeDrag?.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!this.nodeDrag.active && Math.hypot(dx, dy) < 5) return;
        this.nodeDrag.active = true;
        event.preventDefault();
        viewport.addClass("is-panning");
        this.camera.x = start.left + dx;
        this.camera.y = start.top + dy;
        this.cameraInitialized = true;
        this.applyCamera();
      };
      const end = () => {
        if (this.nodeDrag?.active) this.ignoreClickUntil = Date.now() + 200;
        this.nodeDrag = null;
        viewport.removeClass("is-panning");
        this.dragCleanup?.();
      };
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", end);
      doc.addEventListener("pointercancel", end);
      doc.defaultView.addEventListener("blur", end);
      this.dragCleanup = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", end);
        doc.removeEventListener("pointercancel", end);
        doc.defaultView.removeEventListener("blur", end);
        this.dragCleanup = null;
      };
    });
    const graph = viewport.createDiv({ cls: "tag-graph" });
    graph.setAttribute("aria-label", "标签关系");
    const layout = topicGraphLayout(nodes);
    this.layout = layout;
    this.world = graph;
    graph.style.width = `${layout.width}px`;
    graph.style.height = `${layout.height}px`;
    const bounds = topicGroupBounds(nodes, layout.positions, "未规划");
    if (bounds) {
      const region = graph.createDiv({ cls: "tag-graph-region", attr: { "aria-label": "未规划标签" } });
      region.createEl("span", { cls: "tag-graph-region-title", text: "未规划" });
      region.style.left = `${bounds.x}px`;
      region.style.top = `${bounds.y}px`;
      region.style.width = `${bounds.width}px`;
      region.style.height = `${bounds.height}px`;
    }
    const cards = new Map();
    graph.addEventListener("dblclick", (event) => {
      if (event.target.closest("button") || Date.now() < (this.ignoreClickUntil || 0)) return;
      this.adding = true;
      this.render();
    });
    graph.addEventListener("click", (event) => {
      if (Date.now() < (this.ignoreClickUntil || 0)) return;
      if (!event.target.closest("button") && this.selectedTag) { this.selectedTag = null; this.render(); }
    });
    const svg = graph.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "tag-graph-links");
    svg.setAttribute("width", String(layout.width));
    svg.setAttribute("height", String(layout.height));
    svg.setAttribute("aria-hidden", "true");
    graph.appendChild(svg);
    for (const node of nodes.values()) {
      if (!node.parent || node.parent === "未规划") continue;
      const from = layout.positions.get(node.parent);
      const to = layout.positions.get(node.tag);
      const path = graph.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("data-parent", node.parent);
      path.setAttribute("data-child", node.tag);
      path.setAttribute("d", `M ${from.x + 66} ${from.y + 40} C ${from.x + 66} ${from.y + 70}, ${to.x + 66} ${to.y - 30}, ${to.x + 66} ${to.y}`);
      svg.appendChild(path);
    }
    const maximum = Math.max(1, ...[...nodes.values()].map((node) => node.notes.size));
    for (const node of nodes.values()) {
      if (node.tag === "未规划") continue;
      const position = layout.positions.get(node.tag);
      const selected = node.tag === this.selectedTag;
      const label = `${node.tag}，${node.notes.size} 篇笔记${node.parent ? `，上级 ${node.parent}` : ""}`;
      const card = graph.createEl("button", { cls: "tag-graph-node", text: node.tag, attr: { type: "button", "data-topic": node.tag, "data-tone": String(topicNodeTone(node.notes.size, maximum)), "aria-label": label, "aria-pressed": String(selected), title: `${node.notes.size} 篇笔记` } });
      card.style.left = `${position.x}px`;
      card.style.top = `${position.y}px`;
      if (selected) card.addClass("is-selected");
      card.addEventListener("click", () => {
        if (this.saving || Date.now() < (this.ignoreClickUntil || 0)) return;
        this.selectedTag = node.tag;
        this.render();
        new TopicNotesModal(this.view.app, node.tag, node.notes).open();
      });
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (this.saving) return;
        this.selectedTag = selected ? null : node.tag;
        this.render();
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { event.stopPropagation(); this.selectedTag = null; this.render(); }
      });
      cards.set(node.tag, card);
      card.addEventListener("dragstart", (event) => event.preventDefault());
      card.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || this.saving) return;
        this.nodeDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
        const doc = graph.ownerDocument;
        const cancel = (event) => endDrag(event, true);
        const blur = () => { this.dragCleanup?.(); this.render(); };
        doc.addEventListener("pointermove", moveDrag);
        doc.addEventListener("pointerup", endDrag);
        doc.addEventListener("pointercancel", cancel);
        doc.defaultView.addEventListener("blur", blur);
        this.dragCleanup = () => {
          doc.removeEventListener("pointermove", moveDrag);
          doc.removeEventListener("pointerup", endDrag);
          doc.removeEventListener("pointercancel", cancel);
          doc.defaultView.removeEventListener("blur", blur);
          this.dragCleanup = null;
        };
      });
      const moveDrag = (event) => {
        if (this.nodeDrag?.id !== event.pointerId) return;
        const dx = (event.clientX - this.nodeDrag.x) / this.camera.scale;
        const dy = (event.clientY - this.nodeDrag.y) / this.camera.scale;
        if (!this.nodeDrag.active && Math.hypot(dx, dy) * this.camera.scale < 5) return;
        event.preventDefault();
        this.nodeDrag.active = true;
        card.addClass("is-dragging");
        card.style.left = `${position.x + dx}px`;
        card.style.top = `${position.y + dy}px`;
        const rect = graph.getBoundingClientRect();
        const target = topicDropParent(nodes, layout.positions, node.tag, (event.clientX - rect.left) / this.camera.scale, (event.clientY - rect.top) / this.camera.scale);
        for (const [tag, element] of cards) {
          if (tag === target) element.addClass("is-drop-target");
          else element.removeClass("is-drop-target");
        }
        for (const path of svg.querySelectorAll("path")) {
          const parent = path.getAttribute("data-parent");
          const child = path.getAttribute("data-child");
          if (parent !== node.tag && child !== node.tag) continue;
          const from = parent === node.tag ? { x: position.x + dx, y: position.y + dy } : layout.positions.get(parent);
          const to = child === node.tag ? { x: position.x + dx, y: position.y + dy } : layout.positions.get(child);
          path.setAttribute("d", `M ${from.x + 66} ${from.y + 40} C ${from.x + 66} ${from.y + 70}, ${to.x + 66} ${to.y - 30}, ${to.x + 66} ${to.y}`);
        }
      };
      const endDrag = (event, cancelled = false) => {
        if (this.nodeDrag?.id !== event.pointerId) return;
        const active = this.nodeDrag.active;
        this.dragCleanup?.();
        this.nodeDrag = null;
        if (!active) return;
        this.ignoreClickUntil = Date.now() + 200;
        const rect = graph.getBoundingClientRect();
        const target = cancelled ? undefined : topicDropParent(nodes, layout.positions, node.tag, (event.clientX - rect.left) / this.camera.scale, (event.clientY - rect.top) / this.camera.scale);
        if (target === undefined || !this.moveTag(node.tag, target)) this.render();
      };
      if (selected && (node.parent || (!this.view.topics.has(node.tag) && Object.hasOwn(this.parents, node.tag)))) {
        const tools = graph.createDiv({ cls: "tag-node-tools" });
        tools.style.left = `${position.x + 40}px`;
        tools.style.top = `${position.y - 36}px`;
        if (node.parent) this.iconButton(tools, "unlink", "移回顶层", () => this.moveTag(node.tag, null));
        if (!this.view.topics.has(node.tag) && Object.hasOwn(this.parents, node.tag)) this.iconButton(tools, "trash-2", "移除分组", () => this.removeGroup(node.tag));
      }
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.dragCleanup?.();
    this.contentEl.removeEventListener("keydown", this.onKeyDown);
    this.contentEl.empty();
  }
}

function learningNoteTags(frontmatter = {}) {
  const raw = frontmatter.tags;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
  return [...new Set(values.filter((tag) => typeof tag === "string").map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean))];
}

function learningMapZoom(camera, factor, x, y) {
  const scale = Math.max(0.001, Math.min(2, camera.scale * factor));
  const ratio = scale / camera.scale;
  return { scale, x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio };
}

function learningMapPosition(index, dayWidth = 280, rowHeight = 680) {
  return { x: ((index % 7 + 7) % 7) * dayWidth, y: Math.floor(index / 7) * rowHeight };
}

function learningDemoDays(notes, startDay) {
  const days = new Map();
  if (!notes.length) return days;
  const groups = new Map();
  for (const note of notes) {
    const tag = note.tags[0] || "未标标签";
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag).push(note);
  }
  const categories = [...groups.values()];
  for (let day = 0; day < 21; day++) {
    const items = [];
    const count = 2 + day % 3;
    for (let item = 0; item < count; item++) {
      const group = categories[(day + item) % categories.length];
      items.push(group[Math.floor((day + item) / categories.length) % group.length]);
    }
    days.set(shiftDay(startDay, day), [...new Set(items)]);
  }
  return days;
}

class LearningScheduleView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.camera = { x: 40, y: 40, scale: 1 };
    this.days = new Map();
    this.dayWidth = 280;
    this.dayHeight = 480;
    const today = dayKey(Date.now());
    const weekday = new Date(`${today}T12:00:00`).getDay();
    this.origin = shiftDay(today, -((weekday + 6) % 7) - 7);
  }

  getViewType() { return LEARNING_VIEW_TYPE; }
  getDisplayText() { return "学习日程"; }
  getIcon() { return "calendar-days"; }

  async onOpen() {
    this.contentEl.addClass("learning-schedule-view");
    this.contentEl.empty();
    const page = this.contentEl.createDiv({ cls: "learning-schedule" });
    addPortalNavigation(this.contentEl, this.plugin, LEARNING_VIEW_TYPE, this.leaf);
    const header = page.createDiv({ cls: "learning-schedule-header" });
    const title = header.createDiv({ cls: "learning-map-title" });
    title.createEl("h1", { text: "学习日程" });
    title.createEl("span", { cls: "learning-map-demo-label", text: "演示数据" });
    const controls = header.createDiv({ cls: "learning-schedule-controls" });
    for (const [text, action] of [
      ["今天", () => this.focusDay(dayKey(Date.now()))],
      ["查看全部", () => this.fitAll()],
      ["−", () => this.zoom(0.8)],
      ["＋", () => this.zoom(1.25)],
    ]) controls.createEl("button", { text, attr: { "aria-label": text === "−" ? "缩小" : text === "＋" ? "放大" : text } }).addEventListener("click", action);
    this.scaleEl = controls.createEl("span", { cls: "learning-map-scale" });
    this.legend = page.createDiv({ cls: "learning-schedule-legend" });
    this.viewport = page.createDiv({ cls: "learning-map-viewport", attr: { tabindex: "0", "aria-label": "学习日程地图。拖动平移，滚轮缩放，方向键平移，加减键缩放。" } });
    this.world = this.viewport.createDiv({ cls: "learning-map-world" });
    this.viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      this.zoom(Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.008), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    this.viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.viewport.setPointerCapture(event.pointerId);
      this.viewport.addClass("is-dragging");
    });
    this.viewport.addEventListener("pointermove", (event) => {
      if (this.drag?.id !== event.pointerId) return;
      this.camera.x += event.clientX - this.drag.x;
      this.camera.y += event.clientY - this.drag.y;
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.draw();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.viewport.addEventListener(type, () => { this.drag = null; this.viewport.removeClass("is-dragging"); });
    }
    this.viewport.addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) return;
      const day = event.target.closest("[data-day]")?.dataset.day;
      if (day) this.focusDay(day);
    });
    this.viewport.addEventListener("keydown", (event) => {
      if (event.target !== this.viewport) return;
      const moves = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
      if (moves[event.key]) {
        event.preventDefault();
        this.camera.x += moves[event.key][0];
        this.camera.y += moves[event.key][1];
        this.draw();
      } else if (["+", "=", "-"].includes(event.key)) {
        event.preventDefault();
        this.zoom(event.key === "-" ? 0.8 : 1.25);
      }
    });
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.refresh()));
    for (const event of ["create", "delete", "rename"]) this.registerEvent(this.app.vault.on(event, () => this.refresh()));
    this.resizeObserver = new ResizeObserver(() => {
      if (this.needsInitialFit && this.viewport.clientWidth && this.viewport.clientHeight) this.fitAll();
      else this.draw();
    });
    this.resizeObserver.observe(this.viewport);
    this.refresh();
    this.fitAll();
  }

  refresh() {
    if (!this.world) return;
    const notes = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith("knowledge/") && !file.path.startsWith("knowledge/assets/"))
      .map((file) => ({ file, tags: learningNoteTags(this.app.metadataCache.getFileCache(file)?.frontmatter) }))
      .sort((a, b) => a.file.path.localeCompare(b.file.path, "zh-CN"));
    this.days = learningDemoDays(notes, this.origin);
    const tags = [...new Set([...this.days.values()].flatMap((items) => items.flatMap((note) => note.tags)))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    this.legend.empty();
    for (const tag of tags) {
      const item = this.legend.createEl("span", { text: `#${tag}` });
      item.dataset.subjectColor = String(this.tagColor(tag));
    }
    this.draw();
  }

  tagColor(tag) {
    let hash = 0;
    for (const character of tag) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    return hash % 7;
  }

  dayIndex(day) {
    return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${this.origin}T12:00:00Z`)) / 86400000);
  }

  zoom(factor, x = this.viewport.clientWidth / 2, y = this.viewport.clientHeight / 2) {
    this.camera = learningMapZoom(this.camera, factor, x, y);
    this.draw();
  }

  focusDay(day) {
    const scale = Math.min(1.5, Math.max(0.25, (this.viewport.clientHeight - 64) / this.dayHeight));
    const position = learningMapPosition(this.dayIndex(day), this.dayWidth, this.dayHeight + 40);
    this.camera = { scale, x: this.viewport.clientWidth / 2 - (position.x + 130) * scale, y: 32 - position.y * scale };
    this.draw();
  }

  fitAll() {
    if (!this.viewport.clientWidth || !this.viewport.clientHeight) { this.needsInitialFit = true; return; }
    this.needsInitialFit = false;
    const positions = [...this.days.keys()].map((day) => learningMapPosition(this.dayIndex(day), this.dayWidth, this.dayHeight + 40));
    if (!positions.length) { this.focusDay(dayKey(Date.now())); return; }
    const left = Math.min(...positions.map((point) => point.x));
    const top = Math.min(...positions.map((point) => point.y));
    const width = Math.max(...positions.map((point) => point.x)) + 260 - left;
    const height = Math.max(...positions.map((point) => point.y)) + this.dayHeight - top;
    const scale = Math.max(0.001, Math.min(1, (this.viewport.clientWidth - 48) / width, (this.viewport.clientHeight - 48) / height));
    this.camera = { scale, x: (this.viewport.clientWidth - width * scale) / 2 - left * scale, y: (this.viewport.clientHeight - height * scale) / 2 - top * scale };
    this.draw();
  }

  draw() {
    if (!this.world) return;
    const { x, y, scale } = this.camera;
    this.scaleEl.setText(`${Math.round(scale * 1000) / 10}%`);
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.world.empty();
    for (const [day, notes] of this.days) {
      const position = learningMapPosition(this.dayIndex(day), this.dayWidth, this.dayHeight + 40);
      if (position.x + 260 < -x / scale || position.x > (this.viewport.clientWidth - x) / scale || position.y + this.dayHeight < -y / scale || position.y > (this.viewport.clientHeight - y) / scale) continue;
      const column = this.world.createEl("section", { cls: "learning-schedule-day", attr: { "aria-label": day } });
      column.dataset.day = day;
      column.style.left = `${position.x}px`;
      column.style.top = `${position.y}px`;
      column.style.height = `${this.dayHeight}px`;
      if (day === dayKey(Date.now())) column.addClass("is-today");
      const heading = column.createDiv({ cls: "learning-schedule-date" });
      heading.createEl("time", { text: scale < 0.5 ? day.slice(5).replace("-", "/") : `${day} ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${day}T12:00:00`).getDay()]}`, attr: { datetime: day } });
      if (scale < 0.5) heading.style.fontSize = `${Math.min(64, 12 / scale)}px`;
      heading.createEl("span", { text: `${notes.length} 篇` });
      const content = column.createDiv({ cls: "learning-schedule-content" });
      column.classList.toggle("is-overview", scale < 0.5);
      for (const note of notes) {
        const card = content.createEl("button", { cls: "learning-schedule-entry" });
        card.dataset.subjectColor = String(this.tagColor(note.tags[0] || "未标标签"));
        card.setAttribute("aria-label", `${note.file.basename} ${note.tags.join("、")}`);
        card.setAttribute("title", `${note.file.basename}\n${note.tags.map((tag) => `#${tag}`).join(" ")}`);
        card.createEl("span", { cls: "learning-map-note-title", text: note.file.basename });
        const labels = card.createDiv({ cls: "learning-map-tags" });
        for (const tag of note.tags) {
          const label = labels.createEl("span", { text: `#${tag}` });
          label.dataset.subjectColor = String(this.tagColor(tag));
        }
        card.addEventListener("click", () => {
          const current = this.app.vault.getAbstractFileByPath(note.file.path);
          if (isMarkdown(current)) this.app.workspace.getLeaf("tab").openFile(current);
          else new Notice("笔记已移动或删除");
        });
      }
      if (!notes.length) content.createEl("span", { cls: "learning-schedule-empty", text: "暂无内容" });
    }
  }

  async onClose() {
    this.resizeObserver?.disconnect();
    this.contentEl.removeClass("learning-schedule-view");
  }
}

function knowledgeTopicData(app, plugin) {
  const notes = app.vault.getMarkdownFiles()
    .filter((file) => file.path.startsWith("knowledge/") && !file.path.startsWith("knowledge/assets/"))
    .map((file) => ({ file, tags: getAllTags(app.metadataCache.getFileCache(file) || {}) || [] }));
  const topics = knowledgeTopics(notes);
  const stored = plugin.ledger?.data.topicParents ?? (topics.has("微积分") ? {
    "极限与连续": "微积分", "积分": "微积分", "积分方法": "积分", "不定积分": "积分", "泰勒展开": "微积分",
  } : {});
  return { notes, topics, parents: unplannedTopicParents(topics, stored) };
}

function specificTopicTags(tags, hierarchy) {
  return tags.filter((tag) => !tags.some((other) => other !== tag && topicContains(hierarchy, tag, other)));
}

function noteTagColor(tag) {
  const palette = ["#8da4ef", "#9e8cfc", "#d19dff", "#f65cb6", "#ff92ad", "#ff9592", "#ffb381", "#ffca16", "#bde56c", "#3dd68c", "#0bd8b6", "#7ce2fe"];
  let hash = 0;
  for (const character of tag) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return palette[hash % palette.length];
}

class NoteTabColors {
  constructor(plugin) {
    this.plugin = plugin;
    this.headers = new Set();
  }

  clear(header) {
    header.removeAttribute("data-note-topics");
    header.style.removeProperty("--note-topic-mark");
  }

  refresh() {
    const app = this.plugin.app;
    const records = app.workspace.getLeavesOfType("markdown").map((leaf) => {
      const file = leaf.view.file || app.vault.getAbstractFileByPath(leaf.getViewState?.()?.state?.file || "");
      const tags = file ? [...new Set((getAllTags(app.metadataCache.getFileCache(file) || {}) || []).map((tag) => tag.replace(/^#/, "")))] : [];
      return { leaf, tags };
    });
    const hierarchy = topicHierarchy(knowledgeTopics(records), this.plugin.ledger?.data.topicParents || {});
    const headers = new Set();
    const marks = new Map();
    for (const { leaf, tags } of records) {
      const header = leaf.tabHeaderEl;
      const selected = specificTopicTags(tags, hierarchy).sort((a, b) => a.localeCompare(b, "zh-CN"));
      if (!selected.length) {
        if (header) this.clear(header);
        continue;
      }
      const stops = selected.map((tag, index) => `${noteTagColor(tag)} ${index / selected.length * 100}% ${(index + 1) / selected.length * 100}%`).join(", ");
      marks.set(leaf, { tags: selected, stops });
      if (!header) continue;
      header.setAttribute("data-note-topics", selected.join(" "));
      header.style.setProperty("--note-topic-mark", `linear-gradient(to right, ${stops})`);
      headers.add(header);
    }
    for (const header of this.headers) if (!headers.has(header)) this.clear(header);
    this.headers = headers;
    return marks;
  }

  destroy() {
    for (const header of this.headers) this.clear(header);
    this.headers.clear();
  }
}

class FileExplorerOpenTabs {
  constructor(plugin) {
    this.plugin = plugin;
    this.workspace = plugin.app.workspace;
    this.rows = new Map();
  }

  mount(tree) {
    if (!this.section) {
      this.section = tree.ownerDocument.createElement("details");
      this.section.className = "file-explorer-open-tabs";
      this.section.open = true;
      const summary = this.section.createEl("summary");
      const chevron = summary.createSpan({ cls: "open-tabs-chevron", attr: { "aria-hidden": "true" } });
      setIcon(chevron, "chevron-right");
      summary.createSpan({ text: "已打开" });
      this.list = this.section.createEl("ul", { cls: "open-tabs-list", attr: { role: "list" } });
    }
    if (tree.previousElementSibling !== this.section) tree.before(this.section);
    if (!this.tasks) {
      this.tasks = tree.ownerDocument.createElement("section");
      this.tasks.className = "file-explorer-tasks";
      this.tasks.setAttribute("aria-label", "待办与复习");
      const todo = this.tasks.createEl("details", { cls: "sidebar-todo" });
      todo.open = true;
      this.folderSummary(todo, "今日待办");
      this.taskList = todo.createDiv({ cls: "sidebar-todo-entries" });
      const review = this.tasks.createEl("details", { cls: "sidebar-review-decks" });
      review.open = true;
      this.folderSummary(review, "复习卡组");
      this.decks = review.createDiv({ cls: "sidebar-deck-children" });
      void this.refreshTasks();
    }
    if (this.section.previousElementSibling !== this.tasks) this.section.before(this.tasks);
    this.refreshDecks();
  }

  spacedRepetition() {
    return this.plugin.app.plugins.plugins["obsidian-spaced-repetition"];
  }

  folderSummary(folder, name) {
    const summary = folder.createEl("summary", { cls: "sidebar-folder-summary" });
    setIcon(summary.createSpan({ cls: "sidebar-folder-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
    summary.createSpan({ text: name });
    return summary;
  }

  refreshDecks() {
    if (!this.decks) return;
    const sr = this.spacedRepetition();
    // Use the installed plugin's deck tree so the sidebar follows its card grouping settings.
    const core = sr?.isInitialized ? sr.dataManager.osrCore : null;
    const counts = new Map();
    const describe = (deck, remaining, parent = []) => {
      const path = [...parent, deck.deckName];
      counts.set(JSON.stringify(path), {
        due: remaining?.getRepItemCount(1, true) ?? 0,
        fresh: remaining?.getRepItemCount(0, true) ?? 0,
      });
      const children = deck.subdecks.map((child) => describe(child, remaining?.subdecks.find((item) => item.deckName === child.deckName), path));
      return { path, hasCards: deck.getRepItemCount(2, false) > 0, children };
    };
    const decks = (core?.reviewableDeckTree?.subdecks ?? []).map((deck) =>
      describe(deck, core.remainingDeckTree?.subdecks.find((item) => item.deckName === deck.deckName))
    );
    const signature = JSON.stringify(decks);
    if (signature !== this.deckSignature) {
      this.deckSignature = signature;
      this.renderDeckTree(decks);
    }

    const max = Math.max(1, ...[...this.deckIndicators.keys()].map((key) => {
      const { due, fresh } = counts.get(key);
      return due + fresh;
    }));
    for (const [key, indicators] of this.deckIndicators) {
      const { due, fresh } = counts.get(key);
      const total = due + fresh;
      for (const { row, name, dueBar, freshBar, count } of indicators) {
        dueBar.style.width = `${100 * due / max}%`;
        freshBar.style.width = `${100 * fresh / max}%`;
        if (count.textContent !== String(total)) count.textContent = String(total);
        row.title = `${name}，到期 ${due} 张，新卡 ${fresh} 张`;
        row.setAttribute("aria-label", row.title);
      }
    }
  }

  renderDeckTree(decks) {
    const expanded = new Set([...this.decks.querySelectorAll("details[open]")].map((el) => el.dataset.deckPath));
    this.decks.replaceChildren();
    this.deckIndicators = new Map();

    const addIndicator = (row, path, name) => {
      row.lastElementChild.classList.add("sidebar-deck-name");
      const track = row.createSpan({ cls: "sidebar-deck-track", attr: { "aria-hidden": "true" } });
      const dueBar = track.createSpan({ cls: "sidebar-deck-due" });
      const freshBar = track.createSpan({ cls: "sidebar-deck-fresh" });
      const count = row.createSpan({ cls: "sidebar-deck-count", attr: { "aria-hidden": "true" } });
      const key = JSON.stringify(path);
      if (!this.deckIndicators.has(key)) this.deckIndicators.set(key, []);
      this.deckIndicators.get(key).push({ row, name, dueBar, freshBar, count });
    };

    const addButton = (parent, path, name) => {
      const button = parent.createEl("button", { cls: "sidebar-deck-row", type: "button" });
      setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), "layers");
      button.createSpan({ text: name });
      addIndicator(button, path, name);
      button.addEventListener("click", () => void this.openDeck(path));
    };
    const add = (parent, { path, hasCards, children }) => {
      const name = path.at(-1);
      if (children.length) {
        const key = JSON.stringify(path);
        const folder = parent.createEl("details", { attr: { "data-deck-path": key } });
        folder.open = expanded.has(key);
        addIndicator(this.folderSummary(folder, name), path, name);
        const group = folder.createDiv({ cls: "sidebar-deck-children" });
        if (hasCards) addButton(group, path, `复习${name}`);
        for (const child of children) add(group, child);
      } else {
        addButton(parent, path, name);
      }
    };
    const only = decks[0];
    if (decks.length === 1 && only.path[0] === "flashcards" && only.children.length && !only.hasCards) {
      for (const child of only.children) add(this.decks, child);
    } else {
      for (const deck of decks) add(this.decks, deck);
    }
  }

  async openDeck(path) {
    if (this.openingDeck) return;
    this.openingDeck = true;
    try {
      const sr = this.spacedRepetition();
      if (!sr?.isInitialized) throw new Error("请启用 Spaced Repetition 插件");
      const ui = sr.uiManager;
      if (Platform.isDesktopApp) this.plugin.showReadingSidebar();
      const leaf = await this.openReviewSidebar(ui);
      const manager = leaf.view.contentManager;
      ui.setContentManager(manager);
      await manager._showDecksList(true);
      const deck = path.reduce((parent, name) => parent?.subdecks.find((child) => child.deckName === name), manager.reviewSequencer.originalDeckTree);
      if (!deck) throw new Error("卡组已更新，请重新选择");
      await manager._startReviewOfDeck(deck);
      await this.plugin.openReviewScratch();
    } catch (error) {
      new Notice(error.message);
    } finally {
      this.openingDeck = false;
      this.refreshDecks();
    }
  }

  async openReviewSidebar(ui) {
    const workspace = this.workspace;
    let leaf = workspace.getLeavesOfType(FLASHCARD_VIEW_TYPE).find((item) => item.getRoot() === workspace.rightSplit);
    if (!leaf?.view.contentManager) {
      let queueLoader;
      const capture = (loader) => { queueLoader = loader; };
      // Reuse the plugin's loader without opening its modal or changing its global view settings.
      const launcher = Object.create(ui);
      launcher.focusObsidianWindow = () => {};
      launcher.openFlashcardModal = capture;
      launcher.tabViewManager = { openSRTabView: capture };
      await launcher.openDeckContainer(1); // Spaced Repetition review mode.
      if (!queueLoader) throw new Error("卡组正在加载，请稍后重试");

      leaf ??= workspace.getRightLeaf(false);
      if (!leaf) throw new Error("无法打开右侧复习面板");
      const tabManager = ui.tabViewManager;
      const previousLoader = tabManager.reviewQueueLoader;
      tabManager.reviewQueueLoader = queueLoader;
      try {
        await leaf.setViewState({ type: FLASHCARD_VIEW_TYPE, active: true });
        await workspace.revealLeaf(leaf);
      } finally {
        tabManager.reviewQueueLoader = previousLoader;
      }
      leaf.view.setSize(100, 100);
    } else {
      await workspace.revealLeaf(leaf);
    }
    return leaf;
  }

  taskEditor() {
    return this.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === TODO_LIST_PATH && leaf.view.editor)?.view.editor;
  }

  async refreshTasks() {
    const list = this.taskList;
    if (!list) return;
    const request = this.taskRequest = {};
    const vault = this.plugin.app.vault;
    const file = vault.getAbstractFileByPath(TODO_LIST_PATH);
    const today = dayKey(Date.now());
    try {
      const content = this.taskEditor()?.getValue() ?? (file instanceof TFile ? await vault.read(file) : "");
      if (this.taskRequest !== request || this.taskList !== list || (this.taskContent === content && this.taskDay === today)) return;
      const expanded = new Map([...list.querySelectorAll("details")].map((group) => [group.dataset.topic, group.open]));
      this.taskContent = content;
      this.taskDay = today;
      list.replaceChildren();
      const topics = new Map();
      const topicList = (name) => {
        if (!topics.has(name)) {
          const group = list.createEl("details", { attr: { "data-topic": name } });
          group.open = expanded.get(name) ?? true;
          this.folderSummary(group, name);
          topics.set(name, group.createEl("ul", { cls: "sidebar-task-list", attr: { role: "list" } }));
        }
        return topics.get(name);
      };
      let showDay = false;
      let topic = "其他";
      content.split("\n").forEach((line, index) => {
        if (/^#{1,2}\s+/.test(line)) {
          showDay = line.trimEnd() === `## ${today}`;
          topic = "其他";
          return;
        }
        if (!showDay) return;
        const heading = /^###\s+(.+)$/.exec(line.trimEnd());
        if (heading) {
          topic = heading[1];
          topicList(topic);
          return;
        }
        const task = /^([*+-]\s+\[)([ xX])(\]\s+)(.+)$/.exec(line.trimEnd());
        if (!task) return;
        const row = topicList(topic).createEl("li");
        const label = row.createEl("label");
        const box = label.createEl("input", { type: "checkbox" });
        box.checked = task[2] !== " ";
        label.createSpan({ text: task[4] });
        box.addEventListener("change", async () => {
          box.disabled = true;
          const checked = box.checked;
          const saved = await this.updateTasks((current) => {
            const lines = current.split("\n");
            if (lines[index] !== line || dayKey(Date.now()) !== today) throw new Error("待办已更新，请重试");
            const mark = task[1].length;
            lines[index] = line.slice(0, mark) + (checked ? "x" : " ") + line.slice(mark + 1);
            return lines.join("\n");
          });
          if (!saved) box.checked = !checked;
          box.disabled = false;
        });
      });
      if (!topics.size) list.createDiv({ cls: "sidebar-todo-empty", text: "今天还没有待办" });
    } catch (error) {
      if (this.taskRequest === request) new Notice(`无法读取待办：${error.message}`);
    }
  }

  async updateTasks(change) {
    const vault = this.plugin.app.vault;
    const file = vault.getAbstractFileByPath(TODO_LIST_PATH);
    try {
      if (this.plugin.textOrigin.record(TODO_LIST_PATH)) {
        await openNoteTab(this.plugin.app, file);
        throw new Error("这篇笔记启用了文字来源记录，请在正文编辑待办");
      }
      const editor = this.taskEditor();
      if (editor) {
        const before = editor.getValue();
        const after = change(before);
        let start = 0;
        while (start < before.length && before[start] === after[start]) start++;
        let end = before.length;
        let replacementEnd = after.length;
        while (end > start && replacementEnd > start && before[end - 1] === after[replacementEnd - 1]) {
          end--;
          replacementEnd--;
        }
        editor.replaceRange(after.slice(start, replacementEnd), editor.offsetToPos(start), editor.offsetToPos(end));
      } else if (file instanceof TFile) {
        await vault.process(file, change);
      } else {
        await vault.create(TODO_LIST_PATH, change("# 待办事项\n"));
      }
      await this.refreshTasks();
      return true;
    } catch (error) {
      await this.refreshTasks();
      new Notice(error.message);
      return false;
    }
  }

  createRow(leaf) {
    const element = this.list.createEl("li", { cls: "open-tabs-row" });
    const open = element.createEl("button", { cls: "open-tabs-select", attr: { type: "button" } });
    const mark = open.createSpan({ cls: "open-tabs-mark", attr: { "aria-hidden": "true" } });
    const label = open.createSpan({ cls: "open-tabs-label" });
    const close = element.createEl("button", { cls: "open-tabs-close", attr: { type: "button" } });
    setIcon(close, "x");
    open.addEventListener("click", () => this.workspace.setActiveLeaf(leaf, { focus: true }));
    close.addEventListener("click", () => leaf.detach());
    const row = { element, open, mark, label, close };
    this.rows.set(leaf, row);
    return row;
  }

  refresh(marks) {
    const workspace = this.workspace;
    const current = workspace.getMostRecentLeaf(workspace.rootSplit);
    const currentEditor = current?.containerEl;
    if (this.currentEditor !== currentEditor) {
      this.currentEditor?.classList.remove("workbench-current-editor");
      currentEditor?.classList.add("workbench-current-editor");
      this.currentEditor = currentEditor;
    }
    const explorer = workspace.getLeavesOfType("file-explorer").find((leaf) => leaf.getRoot() === workspace.leftSplit);
    // The native file tree has no public insertion point for additional content.
    const tree = explorer?.view.containerEl.querySelector(".nav-files-container");
    if (!tree) {
      this.section?.remove();
      this.tasks?.remove();
      return;
    }

    this.mount(tree);
    const openTabs = new Map();
    workspace.iterateRootLeaves((leaf) => {
      const state = leaf.getViewState();
      if (state.type !== "empty") openTabs.set(leaf, state);
    });
    for (const [leaf, row] of this.rows) {
      if (openTabs.has(leaf)) continue;
      row.element.remove();
      this.rows.delete(leaf);
    }
    this.section.hidden = openTabs.size === 0;

    let next = this.list.firstElementChild;
    for (const [leaf, state] of openTabs) {
      const row = this.rows.get(leaf) ?? this.createRow(leaf);
      const file = leaf.view.file?.path ?? state.state?.file;
      const path = typeof file === "string" ? file : "";
      const title = leaf.getDisplayText() || path?.split("/").pop() || state.type;
      if (row.label.textContent !== title) row.label.textContent = title;
      const mark = marks.get(leaf);
      const tooltip = [path || title];
      if (mark) tooltip.push(mark.tags.map((tag) => `#${tag}`).join(" "));
      row.open.title = tooltip.join("\n");
      row.open.setAttribute("aria-current", leaf === current ? "true" : "false");
      row.mark.style.backgroundImage = mark ? `linear-gradient(to bottom, ${mark.stops})` : "";
      const closeTitle = `关闭 ${title}`;
      row.close.setAttribute("aria-label", closeTitle);
      row.close.title = closeTitle;

      if (row.element !== next) this.list.insertBefore(row.element, next);
      next = row.element.nextElementSibling;
    }
  }

  destroy() {
    this.currentEditor?.classList.remove("workbench-current-editor");
    this.currentEditor = null;
    this.section?.remove();
    this.tasks?.remove();
    this.taskList = null;
    this.decks = null;
    this.rows.clear();
    this.section = null;
    this.list = null;
  }
}

function localTopicNotes(app, file, parents = {}) {
  const readTags = (candidate) => [...new Set((getAllTags(app.metadataCache.getFileCache(candidate) || {}) || []).map((tag) => tag.replace(/^#/, "")))];
  const ownTags = readTags(file);
  const candidates = app.vault.getMarkdownFiles()
    .filter((candidate) => candidate.path !== file.path && candidate.path.startsWith("knowledge/") && !candidate.path.startsWith("knowledge/assets/"))
    .map((candidate) => ({ file: candidate, tags: readTags(candidate) }));
  const hierarchy = topicHierarchy(knowledgeTopics([{ file, tags: ownTags }, ...candidates]), parents);
  const tags = specificTopicTags(ownTags, hierarchy);
  const notes = candidates
    .map((note) => ({ ...note, matchingTags: tags.filter((tag) => note.tags.some((candidate) => topicContains(hierarchy, tag, candidate))) }))
    .filter((note) => note.matchingTags.length)
    .sort((a, b) => a.file.basename.localeCompare(b.file.basename, "zh-CN"));
  return { tags, notes };
}

class LocalTopicMap {
  constructor(model, contentEl) {
    this.model = model;
    this.contentEl = contentEl;
    this.camera = { x: 8, y: 8, scale: 1 };
  }

  mount() {
    this.contentEl.setAttribute("tabindex", "-1");
    this.keyDown = (event) => {
      if (event.key === "Escape") { event.stopPropagation(); this.model.closeFloatingMap(); }
    };
    this.contentEl.addEventListener("keydown", this.keyDown);
    this.sync();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => { if (!this.initialized) this.home(); });
      this.resizeObserver.observe(this.contentEl);
    }
  }

  sync() {
    const file = this.model.leaf.view.file;
    if (!file) return;
    if (this.filePath !== file.path) { this.filePath = file.path; this.initialized = false; }
    this.file = file;
    Object.assign(this, localTopicNotes(this.model.app, file, this.model.plugin.ledger?.data.topicParents));
    this.render();
  }

  icon(parent, icon, title, action) {
    const button = parent.createEl("button", { cls: "local-map-icon", attr: { title, "aria-label": title } });
    setIcon(button, icon);
    button.addEventListener("click", action);
    return button;
  }

  render() {
    this.dragCleanup?.();
    this.contentEl.empty();
    this.contentEl.style.setProperty("--local-map-opacity", "0.72");
    this.contentEl.style.height = `min(${Math.min(300, 130 + Math.ceil((this.notes.length + 1) / 3) * 46)}px, calc(100% - 60px))`;
    const header = this.contentEl.createDiv({ cls: "local-map-header" });
    header.createEl("span", { text: "同标签笔记" });
    const tools = header.createDiv({ cls: "local-map-tools" });
    this.icon(tools, "scan", "查看全部", () => this.fitAll());
    this.icon(tools, "x", "关闭悬浮地图", this.model.closeFloatingMap);
    this.viewport = this.contentEl.createDiv({ cls: "local-map-viewport" });
    this.world = this.viewport.createDiv({ cls: "local-map-world" });
    const notes = [{ file: this.file, matchingTags: this.tags }, ...this.notes];
    this.width = Math.max(360, this.tags.length * 120);
    this.height = 92 + Math.ceil(notes.length / 3) * 50;
    const svg = this.world.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(this.width));
    svg.setAttribute("height", String(this.height));
    svg.setAttribute("class", "local-map-links");
    this.world.appendChild(svg);
    const tagPositions = new Map();
    this.tags.forEach((tag, index) => {
      const x = (this.width - this.tags.length * 120) / 2 + index * 120 + 5;
      tagPositions.set(tag, x);
      const label = this.world.createEl("span", { cls: "local-map-tag", text: tag, attr: { "data-local-tag": tag, title: tag } });
      label.style.left = `${x}px`;
      label.style.top = "8px";
    });
    notes.forEach((note, index) => {
      const current = note.file.path === this.file.path;
      const x = index % 3 * 120 + 5;
      const y = this.tags.length ? 76 + Math.floor(index / 3) * 50 : 8;
      for (const tag of note.matchingTags) {
        const parent = tagPositions.get(tag) + 55;
        const path = this.world.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${parent} 40 C ${parent} 58, ${x + 55} ${y - 18}, ${x + 55} ${y}`);
        svg.appendChild(path);
      }
      this.node(note.file, x, y, current);
    });
    if (!this.tags.length) this.viewport.createEl("p", { cls: "local-map-empty", text: "当前笔记暂无标签" });
    this.viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      this.camera = learningMapZoom(this.camera, Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.008), event.clientX - rect.left, event.clientY - rect.top);
      this.initialized = true;
      this.draw();
    }, { passive: false });
    this.viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const start = { x: event.clientX, y: event.clientY, camera: { ...this.camera } };
      const doc = this.viewport.ownerDocument;
      const move = (event) => {
        event.preventDefault();
        this.camera.x = start.camera.x + event.clientX - start.x;
        this.camera.y = start.camera.y + event.clientY - start.y;
        this.draw();
      };
      const end = () => this.dragCleanup?.();
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", end);
      doc.addEventListener("pointercancel", end);
      doc.defaultView.addEventListener("blur", end);
      this.dragCleanup = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", end);
        doc.removeEventListener("pointercancel", end);
        doc.defaultView.removeEventListener("blur", end);
        this.dragCleanup = null;
      };
    });
    if (!this.initialized) this.home();
    else this.draw();
  }

  node(file, x, y, current) {
    const button = this.world.createEl("button", { cls: "local-map-note", text: file.basename, attr: { "data-note-path": file.path, title: `${file.basename}${current ? "（当前笔记）" : ""}`, "aria-current": current ? "page" : "false" } });
    button.style.left = `${x}px`;
    button.style.top = `${y}px`;
    if (current) button.addClass("is-current");
    button.addEventListener("click", async () => {
      if (current) return;
      const target = this.model.app.vault.getAbstractFileByPath(file.path);
      if (isMarkdown(target)) await openNoteTab(this.model.app, target);
      else new Notice("笔记已移动或删除");
    });
  }

  home() {
    if (!this.viewport?.clientWidth) return;
    this.camera = { x: 8, y: 8, scale: Math.min(1, (this.viewport.clientWidth - 16) / this.width) };
    this.initialized = true;
    this.draw();
  }

  fitAll() {
    const scale = Math.max(0.001, Math.min(1, (this.viewport.clientWidth - 16) / this.width, (this.viewport.clientHeight - 16) / this.height));
    this.camera = { scale, x: (this.viewport.clientWidth - this.width * scale) / 2, y: 8 };
    this.initialized = true;
    this.draw();
  }

  draw() { this.world.style.transform = `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.scale})`; }

  destroy() {
    this.dragCleanup?.();
    this.resizeObserver?.disconnect();
    this.contentEl.removeEventListener("keydown", this.keyDown);
    this.contentEl.empty();
  }
}

class FloatingTopicMaps {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.entries = new Map();
  }

  sync() {
    // Restored background tabs can still contain Obsidian's deferred views.
    const leaves = this.app.workspace.getLeavesOfType("markdown")
      .filter((leaf) => typeof leaf.view.addAction === "function");
    for (const [leaf, entry] of this.entries) {
      if (!leaves.includes(leaf) || entry.view !== leaf.view || !entry.button.isConnected) {
        this.close(leaf);
        entry.button.remove();
        this.entries.delete(leaf);
      }
    }
    for (const leaf of leaves) {
      if (this.entries.has(leaf)) {
        const entry = this.entries.get(leaf);
        if (entry.editor && entry.editor.filePath !== leaf.view.file?.path) entry.editor.sync();
        continue;
      }
      const button = leaf.view.addAction("network", "悬浮知识地图", () => this.toggle(leaf));
      button.addClass("floating-topic-map-toggle");
      button.setAttribute("aria-pressed", "false");
      this.entries.set(leaf, { view: leaf.view, button });
    }
  }

  toggle(leaf) {
    this.sync();
    if (this.entries.get(leaf)?.panel) { this.close(leaf); return; }
    this.open(leaf);
  }

  open(leaf, { focus = true } = {}) {
    this.sync();
    const entry = this.entries.get(leaf);
    if (!entry) return;
    if (entry.panel) return entry.panel;
    entry.panel = entry.view.containerEl.createDiv({ cls: "local-topic-map floating-topic-map", attr: { role: "region", "aria-label": "悬浮知识地图" } });
    entry.model = { app: this.app, plugin: this.plugin, leaf, closeFloatingMap: () => this.close(leaf) };
    entry.editor = new LocalTopicMap(entry.model, entry.panel);
    entry.editor.mount();
    if (focus) entry.panel.focus();
    entry.button.setAttribute("aria-pressed", "true");
    return entry.panel;
  }

  close(leaf) {
    const entry = this.entries.get(leaf);
    if (!entry?.panel) return;
    entry.editor.destroy();
    entry.panel.remove();
    entry.panel = null;
    entry.editor = null;
    entry.model = null;
    entry.button.setAttribute("aria-pressed", "false");
    entry.button.focus();
  }

  refresh() {
    for (const entry of this.entries.values()) {
      if (!entry.editor) continue;
      entry.editor.sync();
    }
  }

  destroy() {
    for (const [leaf, entry] of this.entries) {
      this.close(leaf);
      entry.button.remove();
    }
    this.entries.clear();
  }
}

class KnowledgeTopicsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.refreshTimer = null;
  }

  getViewType() { return TOPICS_VIEW_TYPE; }
  getDisplayText() { return "知识主题"; }
  getIcon() { return "tags"; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("tag-manager-view");
    const page = this.contentEl.createDiv({ cls: "tag-manager-page" });
    addPortalNavigation(this.contentEl, this.plugin, TOPICS_VIEW_TYPE, this.leaf);
    this.editorEl = page.createDiv({ cls: "tag-manager" });
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    for (const event of ["create", "delete", "rename"]) this.registerEvent(this.app.vault.on(event, () => this.scheduleRefresh()));
    this.refresh();
  }

  async onClose() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.editor?.destroy();
    this.editor = null;
    this.editorEl = null;
    this.contentEl.removeClass("tag-manager-view");
  }

  scheduleRefresh() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, 150);
  }

  refresh() {
    if (!this.editorEl) return;
    Object.assign(this, knowledgeTopicData(this.app, this.plugin));
    if (this.editor) this.editor.sync();
    else {
      this.editor = new TopicGraphEditor(this, this.editorEl);
      this.editor.mount();
    }
  }
}

class TodoView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return TODO_VIEW_TYPE; }
  getDisplayText() { return "待办事项"; }
  getIcon() { return "list-checks"; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    const page = root.createDiv({ cls: "personal-todo" });
    addPortalNavigation(this.contentEl, this.plugin, TODO_VIEW_TYPE, this.leaf);
    page.createEl("h1", { text: "待办事项" });
    const form = page.createEl("form", { cls: "personal-todo-form" });
    const input = form.createEl("input", { type: "text", placeholder: "添加待办事项" });
    input.setAttribute("aria-label", "待办事项名称");
    const add = form.createEl("button", { text: "添加", type: "submit" });
    this.list = page.createDiv({ cls: "personal-todo-list" });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      if (/[\\/:*?"<>|#^\[\]\r\n]/.test(name) || name === "." || name === "..") {
        new Notice("名称包含不能用于文件名的字符。 ");
        return;
      }
      add.disabled = true;
      try {
        let folder = this.app.vault.getAbstractFileByPath(TODO_ROOT);
        if (!folder) {
          try { folder = await this.app.vault.createFolder(TODO_ROOT); }
          catch (error) { folder = this.app.vault.getAbstractFileByPath(TODO_ROOT); if (!folder) throw error; }
        }
        if (!(folder instanceof TFolder)) throw new Error("待办事项路径不是文件夹");
        const path = `${TODO_ROOT}/${name}.md`;
        if (this.app.vault.getAbstractFileByPath(path)) throw new Error("已存在同名待办事项");
        const file = await this.app.vault.create(path, "");
        input.value = "";
        this.refresh();
        await this.app.workspace.getLeaf("tab").openFile(file);
      } catch (error) { new Notice(`添加待办失败：${error.message}`); }
      finally { add.disabled = false; }
    });
    for (const event of ["create", "delete", "rename"]) {
      this.registerEvent(this.app.vault.on(event, (file, oldPath) => {
        if (file.path === TODO_ROOT || file.path.startsWith(`${TODO_ROOT}/`) || oldPath === TODO_ROOT || oldPath?.startsWith(`${TODO_ROOT}/`)) this.refresh();
      }));
    }
    this.refresh();
  }

  refresh() {
    if (!this.list) return;
    this.list.empty();
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => file.parent?.path === TODO_ROOT)
      .sort((a, b) => a.basename.localeCompare(b.basename, "zh-CN"));
    if (!files.length) { this.list.createEl("p", { text: "暂无待办事项" }); return; }
    for (const file of files) {
      const button = this.list.createEl("button", { cls: "personal-todo-item", text: file.basename });
      button.addEventListener("click", () => {
        const current = this.app.vault.getAbstractFileByPath(file.path);
        if (isMarkdown(current) && current.parent?.path === TODO_ROOT) this.app.workspace.getLeaf("tab").openFile(current);
        else new Notice("待办事项已移动或删除");
      });
    }
  }
}

class VocabularyWorkbenchView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VOCABULARY_VIEW_TYPE; }
  getDisplayText() { return "词汇内化"; }
  getIcon() { return "book-open"; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("vocabulary-workbench-view-content");
    const page = root.createDiv({ cls: "vocabulary-workbench" });
    addPortalNavigation(this.contentEl, this.plugin, VOCABULARY_VIEW_TYPE, this.leaf);
    const frame = page.createEl("iframe", { cls: "vocabulary-workbench-frame" });
    frame.title = "词汇内化 · 英语学习工作台";
    frame.src = `${VOCABULARY_URL}/`;
  }
}

function talkTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function talkLookupTerm(text) {
  return text.trim().replace(/^[“"'(\[]+|[”"').,!?;:\]]+$/g, "").replace(/\s+/g, " ").toLowerCase();
}

function lastTalkEntryAt(entries, time) {
  let left = 0;
  let right = entries.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (entries[middle].startMs <= time) left = middle + 1;
    else right = middle;
  }
  return left - 1;
}

class TalkImagePicker extends FuzzySuggestModal {
  constructor(app, insert) {
    super(app);
    this.insert = insert;
    this.setPlaceholder("搜索库里的图片");
  }

  getItems() { return this.app.vault.getFiles().filter((file) => TALK_IMAGE_EXTENSIONS.has(file.extension.toLowerCase())); }
  getItemText(file) { return file.path; }
  onChooseItem(file) { this.insert(`![[${file.path}]]`); }
}

class TalkReviewView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return TALK_VIEW_TYPE; }
  getDisplayText() { return "演讲回看"; }
  getIcon() { return "presentation"; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("talk-review");
    addPortalNavigation(root, this.plugin, TALK_VIEW_TYPE, this.leaf);
    const shell = root.createDiv({ cls: "talk-review-shell" });
    const heading = shell.createEl("header", { cls: "talk-review-heading" });
    heading.createEl("h1", { text: "All Code Is Slop (Except Mine)" });
    heading.createEl("a", {
      text: "Lauren Tan / AI Engineer",
      href: `https://ai.engineer/talks/${TALK_ID}-all-code-is-slop-except-mine`,
      cls: "external-link",
    });
    const status = shell.createEl("p", { text: "正在加载演讲…" });
    const adapter = this.app.vault.adapter;
    try {
      const [transcript, slides] = await Promise.all([
        adapter.read(`${TALK_ASSETS}/transcript.json`).then(JSON.parse),
        adapter.read(`${TALK_ASSETS}/slides.json`).then(JSON.parse),
      ]);
      if (!shell.isConnected) return;
      status.remove();
      this.renderTalk(shell, transcript, slides);
    } catch (error) {
      console.error("演讲回看：读取演讲资料失败", error);
      status.setText("无法读取演讲资料。请检查 tmp/yt-dlp/talks 下的样本文件。");
      if (!status.isConnected && shell.isConnected) shell.appendChild(status);
    }
  }

  renderTalk(shell, transcript, { titles, occurrences }) {
    const resource = (path) => this.app.vault.adapter.getResourcePath(path);
    const modes = shell.createDiv({ cls: "talk-review-modes", attr: {
      role: "group", "aria-label": "演讲查看方式",
    } });
    const readButton = modes.createEl("button", { text: "读讲稿" });
    const watchButton = modes.createEl("button", { text: "看视频" });
    const readingLayout = shell.createDiv({ cls: "talk-review-reading-layout" });
    const reader = readingLayout.createEl("article", { cls: "talk-review-reader", attr: { "aria-label": "英文讲稿" } });
    this.renderWordLookup(readingLayout, reader);
    const columns = shell.createDiv({ cls: "talk-review-columns" });
    const media = columns.createEl("section", { cls: "talk-review-media", attr: { "aria-label": "视频与字幕" } });
    const video = media.createEl("video", { cls: "talk-review-video", attr: {
      controls: "", preload: "metadata", playsinline: "", "aria-label": "演讲视频",
    } });
    this.video = video;
    const videoError = media.createEl("p", { attr: { hidden: "", role: "alert" } });
    video.addEventListener("error", () => {
      videoError.setText("本地视频无法播放。");
      videoError.createEl("a", { text: "在 YouTube 打开", href: `https://www.youtube.com/watch?v=${TALK_ID}`, cls: "external-link" });
      videoError.hidden = false;
    }, { once: true });
    const transcriptHeader = media.createDiv({ cls: "talk-review-toolbar" });
    transcriptHeader.createEl("h2", { text: "英文字幕" });
    const followLabel = transcriptHeader.createEl("label", { cls: "talk-review-follow" });
    const follow = followLabel.createEl("input", { type: "checkbox" });
    follow.checked = true;
    followLabel.appendText("跟随播放");
    const transcriptList = media.createDiv({ cls: "talk-review-transcript" });
    const seek = (ms) => {
      video.currentTime = ms / 1000;
      sync();
    };
    const rows = transcript.map(({ startMs, text }) => {
      const row = transcriptList.createDiv({ cls: "talk-review-cue" });
      const time = talkTime(startMs);
      const jump = row.createEl("button", {
        cls: "talk-review-time", text: time, attr: { "aria-label": `跳到 ${time}` },
      });
      row.createSpan({ cls: "talk-review-cue-text", text });
      jump.addEventListener("click", () => seek(startMs));
      return row;
    });

    const deck = columns.createEl("section", { cls: "talk-review-deck", attr: { "aria-label": "幻灯片" } });
    const slide = deck.createEl("img", { cls: "talk-review-slide" });
    const toolbar = deck.createDiv({ cls: "talk-review-toolbar" });
    toolbar.createEl("h2", { text: "幻灯片" });
    const pageSelect = toolbar.createEl("select", { attr: { "aria-label": "跳到幻灯片" } });
    const slideStatus = deck.createDiv({ cls: "talk-review-slide-status" });
    slide.addEventListener("error", () => { slideStatus.setText("无法加载当前幻灯片"); });
    const editor = deck.createEl("details", { cls: "talk-review-marker" });
    editor.createEl("summary", { text: "补标幻灯片时间" });
    const markControls = editor.createDiv({ cls: "talk-review-marker-controls" });
    const markPage = markControls.createEl("select", { attr: { "aria-label": "要标记的幻灯片" } });
    const saveMarker = markControls.createEl("button", { text: "标记当前位置" });
    const deleteMarker = markControls.createEl("button", { text: "移除当前补标", attr: { hidden: "" } });
    const markers = () => this.plugin.ledger.data.talkSlideMarkers?.[TALK_ID] ?? [];
    const firstStart = new Map();
    for (const entry of occurrences) if (!firstStart.has(entry.page)) firstStart.set(entry.page, entry.startMs);
    titles.forEach((title, index) => {
      const page = index + 1;
      pageSelect.createEl("option", { value: String(page), text: `${page}. ${title}` });
      markPage.createEl("option", { value: String(page), text: `${page}. ${title}` });
    });
    pageSelect.addEventListener("change", () => {
      const page = Number(pageSelect.value);
      const markedStart = markers().find((mark) => mark.page === page)?.startMs ?? Infinity;
      const start = Math.min(firstStart.get(page) ?? Infinity, markedStart);
      if (Number.isFinite(start)) seek(start);
    });

    let cueIndex = -1;
    let shownPage = null;
    let activeMarker;
    const scrollToCue = () => {
      if (cueIndex < 0 || !follow.checked) return;
      const selection = transcriptList.ownerDocument.getSelection();
      if (selection?.rangeCount && !selection.isCollapsed &&
          selection.getRangeAt(0).intersectsNode(transcriptList)) return;
      const row = rows[cueIndex];
      transcriptList.scrollTop = row.offsetTop - (transcriptList.clientHeight - row.offsetHeight) / 2;
    };
    const sync = () => {
      const ms = Math.round(video.currentTime * 1000);
      const nextCue = lastTalkEntryAt(transcript, ms);
      if (nextCue !== cueIndex) {
        rows[cueIndex]?.removeAttribute("aria-current");
        cueIndex = nextCue;
        rows[cueIndex]?.setAttribute("aria-current", "true");
        scrollToCue();
      }
      const official = occurrences[lastTalkEntryAt(occurrences, ms)];
      const saved = markers();
      const marker = saved[lastTalkEntryAt(saved, ms)];
      activeMarker = marker && (!official || marker.startMs >= official.startMs) ? marker : undefined;
      const page = activeMarker?.page ?? official?.page ?? 1;
      pageSelect.value = String(page);
      deleteMarker.hidden = !activeMarker;
      saveMarker.disabled = video.readyState === 0;
      const label = activeMarker ? `手动补标 ${talkTime(activeMarker.startMs)}`
        : ms < (official?.endMs ?? 0) ? `第 ${page} / ${titles.length} 页` : "当前时间无换页记录";
      if (slideStatus.textContent !== label) slideStatus.setText(label);
      if (page !== shownPage) {
        shownPage = page;
        slide.alt = `第 ${page} 页，${titles[page - 1]}`;
        slide.src = resource(`${TALK_ASSETS}/slide-${String(page).padStart(2, "0")}.jpg`);
        if (!editor.open) markPage.value = String(page);
      }
    };
    const updateMarker = async (entry, remove = false) => {
      try {
        await this.plugin.updateTalkSlideMarker(entry, remove);
        sync();
      } catch (error) {
        console.error("演讲回看：保存补标失败", error);
        new Notice("无法保存幻灯片补标");
      }
    };
    saveMarker.addEventListener("click", () => updateMarker({
      page: Number(markPage.value),
      startMs: Math.round(video.currentTime * 1000),
    }));
    deleteMarker.addEventListener("click", () => {
      if (activeMarker) updateMarker(activeMarker, true);
    });
    follow.addEventListener("change", scrollToCue);
    for (const event of ["timeupdate", "seeking", "loadedmetadata"]) video.addEventListener(event, sync);
    let reading;
    let readerScroll = 0;
    const setReading = (next) => {
      if (reading === next) return;
      if (reading) readerScroll = shell.scrollTop;
      reading = next;
      readingLayout.hidden = !reading;
      columns.hidden = reading;
      readButton.setAttribute("aria-pressed", String(reading));
      watchButton.setAttribute("aria-pressed", String(!reading));
      shell.scrollTop = reading ? readerScroll : 0;
      if (reading) video.pause();
      else scrollToCue();
    };
    this.renderReader(reader, transcript, { titles, occurrences }, (time) => {
      setReading(false);
      seek(time);
      watchButton.focus({ preventScroll: true });
    });
    readButton.addEventListener("click", () => setReading(true));
    watchButton.addEventListener("click", () => setReading(false));
    setReading(true);
    video.src = resource(`tmp/yt-dlp/videos/${TALK_ID}.webm`);
    sync();
  }

  renderWordLookup(layout, reader) {
    const panel = layout.createEl("aside", { cls: "talk-review-lookup", attr: { "aria-label": "查词" } });
    panel.createEl("h2", { text: "查词" });
    const form = panel.createEl("form", { cls: "talk-review-lookup-form" });
    const input = form.createEl("input", { attr: {
      type: "search", placeholder: "输入或选中英文词", "aria-label": "英文单词或短语",
      autocomplete: "off", spellcheck: "false", maxlength: "100",
    } });
    form.createEl("button", { text: "查词", attr: { type: "submit" } });
    const result = panel.createDiv({ cls: "talk-review-lookup-result", attr: { "aria-live": "polite" } });
    const card = panel.createDiv({ cls: "talk-review-word-card" });
    const host = panel.ownerDocument.defaultView;
    const valid = (term) => term.length <= 100 && /^[a-z]+(?:[ -][a-z]+)*$/.test(term);
    const pickSelection = () => {
      const selection = reader.ownerDocument.getSelection();
      if (!selection?.anchorNode || !selection.focusNode || selection.isCollapsed) return;
      const from = selection.anchorNode.parentElement?.closest(".talk-review-passage > p");
      const to = selection.focusNode.parentElement?.closest(".talk-review-passage > p");
      if (!from || from !== to || !reader.contains(from)) return;
      const term = talkLookupTerm(selection.toString());
      if (valid(term)) input.value = term;
    };
    for (const event of ["pointerup", "keyup"]) reader.addEventListener(event, pickSelection);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const term = talkLookupTerm(input.value);
      if (!valid(term)) {
        result.setText("请输入英文单词或短语。");
        return;
      }
      result.empty();
      this.closeLookupCard?.();
      result.setText("正在打开词卡…");
      const frame = card.createEl("iframe", { attr: { title: `${term} 单词卡`, hidden: "" } });
      const receive = (message) => {
        if (message.origin !== VOCABULARY_URL || message.source !== frame.contentWindow) return;
        if (message.data === "vocab-word-card:ready") {
          host.clearTimeout(timer);
          result.empty();
          frame.hidden = false;
        }
        if (message.data === "vocab-word-card:close") {
          this.closeLookupCard?.();
          input.focus({ preventScroll: true });
        }
      };
      const timer = host.setTimeout(() => {
        result.setText("无法打开词卡，请检查「词汇内化」服务后重试。");
      }, 10000);
      this.closeLookupCard = () => {
        host.clearTimeout(timer);
        host.removeEventListener("message", receive);
        frame.remove();
        this.closeLookupCard = null;
      };
      host.addEventListener("message", receive);
      const params = new URLSearchParams({ wordCard: term });
      const palette = host.getComputedStyle(panel);
      params.set("appearance", "obsidian");
      params.set("scheme", panel.closest(".theme-dark") ? "dark" : "light");
      for (const [name, variable] of Object.entries(WORD_CARD_PALETTE)) {
        params.set(name, palette.getPropertyValue(variable).trim());
      }
      if (term === "slop") params.set("meaning", "草率写成、质量差的代码");
      frame.src = `${VOCABULARY_URL}/?${params}`;
    });
  }

  renderReader(reader, transcript, slides, watchAt) {
    const chapterBar = reader.createDiv({ cls: "talk-review-chapters" });
    const chapters = chapterBar.createEl("select", { attr: { "aria-label": "跳到讲稿章节" } });
    const sections = [];
    let cursor = 0;
    for (const [index, [startMs, title]] of TALK_CHAPTERS.entries()) {
      chapters.createEl("option", { value: String(index), text: `${talkTime(startMs)}  ${title}` });
      const section = reader.createEl("section");
      sections.push(section);
      section.createEl("h2", { text: title });
      const endMs = TALK_CHAPTERS[index + 1]?.[0] ?? Infinity;
      let paragraph = "";
      let paragraphStart;
      let illustratedPage;
      const emit = () => {
        const start = paragraphStart;
        const end = Math.min(endMs, transcript[cursor]?.startMs ?? Infinity);
        const coverageByPage = new Map();
        for (const occurrence of slides.occurrences) {
          if (occurrence.startMs >= end) break;
          const coverage = Math.min(end, occurrence.endMs) - Math.max(start, occurrence.startMs);
          if (coverage > 0) {
            coverageByPage.set(occurrence.page, (coverageByPage.get(occurrence.page) ?? 0) + coverage);
          }
        }
        let bestPage;
        let bestCoverage = 0;
        for (const [page, coverage] of coverageByPage) {
          if (coverage > bestCoverage) {
            bestPage = page;
            bestCoverage = coverage;
          }
        }
        if (bestPage && bestPage !== illustratedPage) {
          illustratedPage = bestPage;
          const figure = section.createEl("figure", { cls: "talk-review-article-slide" });
          const path = `${TALK_ASSETS}/slide-${String(bestPage).padStart(2, "0")}.jpg`;
          figure.createEl("img", { attr: {
            src: this.app.vault.adapter.getResourcePath(path),
            alt: slides.titles[bestPage - 1],
            width: "1440", height: "810", loading: "lazy",
          } });
        }
        const row = section.createDiv({ cls: "talk-review-passage" });
        const jump = row.createEl("button", {
          text: talkTime(start), cls: "talk-review-time",
          attr: { "aria-label": `看视频，跳到 ${talkTime(start)}` },
        });
        jump.addEventListener("click", () => watchAt(start));
        row.createEl("p", { text: paragraph });
        this.renderPassageExtras(row, start, slides);
        paragraph = "";
      };
      while (cursor < transcript.length && transcript[cursor].startMs < endMs) {
        const cue = transcript[cursor++];
        if (!paragraph) paragraphStart = cue.startMs;
        paragraph = paragraph ? `${paragraph} ${cue.text}` : cue.text;
        if (paragraph.length >= 530 || (paragraph.length >= 290 && /[.!?]$/.test(paragraph))) emit();
      }
      if (paragraph) emit();
    }
    chapters.addEventListener("change", () => {
      const section = sections[Number(chapters.value)];
      section.scrollIntoView({ block: "start" });
    });
  }

  renderPassageExtras(row, start, { titles, occurrences }) {
    const sourcePath = `${TALK_ASSETS}/transcript.json`;
    const key = String(start);
    const getMarkdown = () => this.plugin.ledger.data.talkPassageExtras?.[TALK_ID]?.[key] ?? "";
    const toggle = row.createEl("button", { cls: "talk-review-extra-toggle", attr: { type: "button" } });
    const block = row.createDiv({ cls: "talk-review-extra" });
    let rendered;
    const show = () => {
      if (rendered) this.removeChild(rendered);
      rendered = undefined;
      block.empty();
      const markdown = getMarkdown();
      toggle.setAttribute("aria-label", markdown ? "编辑段落补充内容" : "添加段落补充内容");
      toggle.setAttribute("title", toggle.getAttribute("aria-label"));
      toggle.dataset.hasContent = String(Boolean(markdown));
      setIcon(toggle, markdown ? "pencil" : "plus");
      block.hidden = !markdown;
      if (!markdown) return;
      rendered = this.addChild(new Component());
      const preview = block.createDiv({ cls: "markdown-rendered talk-review-extra-preview" });
      MarkdownRenderer.render(this.app, markdown, preview, sourcePath, rendered).catch((error) => {
        console.error("演讲回看：渲染补充内容失败", error);
        preview.setText(markdown);
      });
    };
    const edit = () => {
      if (rendered) this.removeChild(rendered);
      rendered = undefined;
      block.empty();
      block.hidden = false;
      toggle.disabled = true;
      const initial = getMarkdown();
      const input = block.createEl("textarea", { attr: { "aria-label": "段落补充内容", placeholder: "写下你的理解或疑问，支持 Markdown", rows: "4" } });
      input.value = initial;
      const insert = (markdown) => {
        const from = input.selectionStart;
        const to = input.selectionEnd;
        input.setRangeText(`\n\n${markdown}\n\n`, from, to, "end");
        input.focus();
      };
      const actions = block.createDiv({ cls: "talk-review-extra-actions" });
      const page = actions.createEl("select", { attr: { "aria-label": "要插入的 PPT 页" } });
      titles.forEach((title, index) => page.createEl("option", { value: String(index + 1), text: `${index + 1}. ${title}` }));
      page.value = String(occurrences[lastTalkEntryAt(occurrences, start)]?.page ?? 1);
      const slideButton = actions.createEl("button", { text: "插入 PPT 页" });
      slideButton.addEventListener("click", () => {
        const number = page.value.padStart(2, "0");
        insert(`![[${TALK_ASSETS}/slide-${number}.jpg]]`);
      });
      const imageButton = actions.createEl("button", { text: "插入图片" });
      imageButton.addEventListener("click", () => new TalkImagePicker(this.app, insert).open());
      const save = actions.createEl("button", { text: "保存", cls: "mod-cta" });
      const cancel = actions.createEl("button", { text: "取消" });
      const close = () => {
        toggle.disabled = false;
        show();
        toggle.focus({ preventScroll: true });
      };
      save.addEventListener("click", async () => {
        const draft = input.value.trim();
        const controls = [input, page, slideButton, imageButton, save, cancel];
        controls.forEach((control) => { control.disabled = true; });
        try {
          await this.plugin.saveTalkPassageExtra(key, draft, initial);
          if (block.isConnected) close();
        } catch (error) {
          new Notice(error.message);
        } finally {
          controls.forEach((control) => { control.disabled = false; });
        }
      });
      cancel.addEventListener("click", close);
      input.focus();
    };
    toggle.addEventListener("click", edit);
    show();
  }

  async onClose() {
    this.closeLookupCard?.();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      this.video = null;
    }
    this.contentEl.empty();
  }
}

const ORIGINS = new Set(["human", "ai", "mixed"]);

function normalize(spans) {
  const result = [];
  for (const span of spans.filter((item) => item.from < item.to && ORIGINS.has(item.origin)).sort((a, b) => a.from - b.from)) {
    const previous = result[result.length - 1];
    if (previous && previous.to === span.from && previous.origin === span.origin) previous.to = span.to;
    else result.push({ ...span });
  }
  return result;
}

function validRecord(record) {
  if (!record || typeof record.text !== "string" || !Array.isArray(record.spans)) return false;
  let end = 0;
  for (const span of record.spans) {
    if (!Number.isInteger(span.from) || !Number.isInteger(span.to) || span.from < end || span.from >= span.to ||
        span.to > record.text.length || !ORIGINS.has(span.origin)) return false;
    end = span.to;
  }
  return true;
}

function setOrigin(record, from, to, origin) {
  if (!validRecord(record) || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to || to > record.text.length ||
      (origin !== "unknown" && !ORIGINS.has(origin))) throw new Error("文字范围或来源无效");
  const spans = [];
  for (const span of record.spans) {
    if (span.to <= from || span.from >= to) spans.push(span);
    else {
      if (span.from < from) spans.push({ ...span, to: from });
      if (span.to > to) spans.push({ ...span, from: to });
    }
  }
  if (origin !== "unknown") spans.push({ from, to, origin });
  return { text: record.text, spans: normalize(spans) };
}

function applyChanges(record, changes, origin) {
  if (!validRecord(record) || !Array.isArray(changes) || (origin !== "unknown" && !ORIGINS.has(origin))) {
    throw new Error("文字来源记录无效");
  }
  const ordered = changes.map((change) => ({ ...change })).sort((a, b) => b.from - a.from || b.to - a.to);
  let nextFrom = record.text.length;
  let previousFrom = null;
  for (const change of ordered) {
    if (!Number.isInteger(change.from) || !Number.isInteger(change.to) || typeof change.insert !== "string" ||
        change.from < 0 || change.to < change.from || change.to > nextFrom || change.to > record.text.length ||
        (change.from === change.to && !change.insert) || change.from === previousFrom) throw new Error("修改范围无效或互相重叠");
    nextFrom = change.from;
    previousFrom = change.from;
  }
  let current = { text: record.text, spans: record.spans.map((span) => ({ ...span })) };
  for (const { from, to, insert } of ordered) {
    if (current.text.slice(from, to) === insert) continue;
    const related = current.spans.filter((span) => from === to
      ? span.from < from && from < span.to
      : span.from < to && span.to > from);
    let insertedOrigin = origin;
    if ((origin === "human" || origin === "ai") && related.some((span) => span.origin === "mixed" ||
        (span.origin !== origin && span.origin !== "unknown"))) insertedOrigin = "mixed";
    const delta = insert.length - (to - from);
    const spans = [];
    for (const span of current.spans) {
      if (span.to <= from) spans.push(span);
      else if (span.from >= to) spans.push({ ...span, from: span.from + delta, to: span.to + delta });
      else {
        if (span.from < from) spans.push({ ...span, to: from });
        if (span.to > to) spans.push({ ...span, from: from + insert.length, to: span.to + delta });
      }
    }
    if (insert && insertedOrigin !== "unknown") spans.push({ from, to: from + insert.length, origin: insertedOrigin });
    current = { text: current.text.slice(0, from) + insert + current.text.slice(to), spans: normalize(spans) };
  }
  return current;
}


const ORIGIN_DATA_PATH = ".obsidian/plugins/note-activity/text-origin-data.json";
const ORIGIN_LABELS = { human: "我写的", ai: "AI 写的", mixed: "共同修改" };

class ResetTextOriginModal extends Modal {
  constructor(origin, editor, view, path) {
    super(origin.app);
    this.origin = origin;
    this.editor = editor;
    this.view = view;
    this.path = path;
  }
  onOpen() {
    this.titleEl.setText("重新开始记录文字来源");
    this.contentEl.createEl("p", { text: "当前文字会变为来源未知。原有记录会保存在数据文件中。" });
    const button = this.contentEl.createEl("button", { text: "重新开始", cls: "mod-warning" });
    button.addEventListener("click", () => {
      if (this.view.file?.path !== this.path || !this.origin.records[this.path]) {
        new Notice("笔记已移动或记录已变化，请重新选择。");
        this.close();
        return;
      }
      this.origin.reset(this.path, this.editor.getValue());
      this.close();
      new Notice("已重新开始，当前文字来源未知。");
    });
  }
  onClose() { this.contentEl.empty(); }
}

class TextOrigin {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.records = {};
    this.archives = [];
    this.visible = true;
    this.views = new Set();
    this.applying = false;
    this.pendingSave = false;
    this.savePromise = null;
  }

  async load() {
    const adapter = this.app.vault.adapter;
    if (!await adapter.exists(ORIGIN_DATA_PATH)) return;
    try {
      const stored = JSON.parse(await adapter.read(ORIGIN_DATA_PATH));
      if (stored.version !== 1 || !stored.records || typeof stored.records !== "object") throw new Error("不支持的记录格式");
      this.visible = stored.visible !== false;
      for (const [path, record] of Object.entries(stored.records)) {
        if (validRecord(record)) this.records[path] = record;
        else throw new Error(`记录无效：${path}`);
      }
      if (stored.archives !== undefined) {
        if (!Array.isArray(stored.archives) || stored.archives.some((entry) => typeof entry.path !== "string" || !validRecord(entry.record))) {
          throw new Error("归档记录无效");
        }
        this.archives = stored.archives;
      }
    } catch (error) {
      // Keep the original file intact if it cannot be read.
      this.records = {};
      this.archives = [];
      this.readOnly = true;
      console.error("文字来源：读取失败", error);
      new Notice("文字来源记录读取失败，已暂停写入，请检查数据文件。");
    }
  }

  install() {
    const { editorInfoField } = require("obsidian");
    const { StateEffect, RangeSetBuilder } = require("@codemirror/state");
    const { Decoration, ViewPlugin } = require("@codemirror/view");
    this.refreshEffect = StateEffect.define();
    const origin = this;
    const extension = ViewPlugin.fromClass(class {
      constructor(view) {
        this.view = view;
        this.decorations = Decoration.none;
        origin.views.add(this);
        this.draw();
      }
      path(state) { return state.field(editorInfoField, false)?.file?.path || null; }
      update(update) {
        const path = this.path(update.state);
        if (update.docChanged && path && !origin.applying) origin.editorChanged(path, update);
        this.draw();
      }
      draw() {
        const path = this.path(this.view.state);
        const record = path && origin.record(path);
        if (!origin.visible || !record || record.text !== this.view.state.doc.toString()) {
          this.decorations = Decoration.none;
          return;
        }
        const builder = new RangeSetBuilder();
        for (const span of record.spans) {
          builder.add(span.from, span.to, Decoration.mark({
            class: `text-origin-${span.origin}`,
            attributes: { title: ORIGIN_LABELS[span.origin], "data-text-origin": ORIGIN_LABELS[span.origin] },
          }));
        }
        this.decorations = builder.finish();
      }
      destroy() { origin.views.delete(this); }
    }, { decorations: (view) => view.decorations });
    this.plugin.registerEditorExtension(extension);

    this.status = this.plugin.addStatusBarItem();
    this.status.addClass("text-origin-status");
    this.statusButton = this.status.createEl("button", { cls: "text-origin-status-button" });
    this.statusButton.addEventListener("click", () => {
      if (this.readOnly) return new Notice("文字来源数据无法读取，请检查数据文件。");
      const view = this.app.workspace.activeLeaf?.view;
      const path = isMarkdown(view?.file) ? view.file.path : null;
      const editor = view?.editor;
      const record = path && this.record(path);
      if (editor && path && !this.records[path]) return this.start(editor, view);
      if (editor && path && this.records[path] && (!record || record.text !== editor.getValue())) {
        return new ResetTextOriginModal(this, editor, view, path).open();
      }
      this.visible = !this.visible;
      this.changed();
    });
    this.refreshStatus();
    this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshStatus()));
    this.plugin.registerEvent(this.app.workspace.on("file-open", () => this.refreshStatus()));
    this.plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.rename(oldPath, file.path, file instanceof TFolder)));
    this.plugin.registerEvent(this.app.vault.on("delete", (file) => this.removed(file.path, file instanceof TFolder)));

    this.plugin.addCommand({ id: "origin-start", name: "开始记录当前笔记的文字来源", editorCallback: (editor, view) => this.start(editor, view) });
    this.plugin.addCommand({ id: "origin-reset", name: "重新开始记录当前笔记的文字来源", editorCallback: (editor, view) => {
      const path = view?.file?.path;
      if (!path || this.readOnly) return new Notice("无法重新开始记录文字来源。");
      if (!this.records[path]) return this.start(editor, view);
      new ResetTextOriginModal(this, editor, view, path).open();
    } });
    for (const [source, label] of Object.entries(ORIGIN_LABELS)) {
      this.plugin.addCommand({ id: `origin-mark-${source}`, name: `将选中文字标记为${label}`, editorCallback: (editor, view) => this.mark(editor, view, source) });
    }
    this.plugin.addCommand({ id: "origin-mark-unknown", name: "将选中文字标记为来源未知", editorCallback: (editor, view) => this.mark(editor, view, "unknown") });
    this.plugin.addCommand({ id: "origin-toggle", name: "显示或隐藏文字来源标识", callback: () => { this.visible = !this.visible; this.changed(); } });
  }

  record(path) {
    const record = this.records[path];
    return record && !record.inactive ? record : null;
  }

  start(editor, view) {
    const path = isMarkdown(view?.file) ? view.file.path : null;
    if (!path || this.readOnly) return new Notice("无法开始记录文字来源。");
    if (this.records[path]) return new Notice("这篇笔记已有记录；如需清除当前标识，请使用重新开始命令。");
    this.records[path] = { text: editor.getValue(), spans: [] };
    this.changed();
    new Notice("已开始记录。已有文字来源未知；紫色为 AI，绿色为我，橙色为共同修改。");
  }

  reset(path, text) {
    if (!this.records[path] || typeof text !== "string" || this.readOnly) return;
    this.archives.push({ path, archivedAt: Date.now(), record: this.records[path] });
    this.records[path] = { text, spans: [] };
    this.changed();
  }

  mark(editor, view, source) {
    const path = view?.file?.path;
    const record = this.record(path);
    if (!record || this.readOnly) return new Notice("请先开始记录这篇笔记的文字来源。");
    if (record.text !== editor.getValue()) return new Notice("文字已在记录之外发生变化，暂不能标记。请查看插件说明。");
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    if (from === to) return new Notice("请先选择需要标记的文字。");
    this.records[path] = setOrigin(record, from, to, source);
    this.changed();
    new Notice(source === "unknown" ? "已标记为来源未知" : `已标记为${ORIGIN_LABELS[source]}`);
  }

  editorChanged(path, update) {
    const record = this.record(path);
    if (!record || this.readOnly || record.text !== update.startState.doc.toString()) return;
    const transactions = update.transactions.filter((transaction) => transaction.docChanged);
    // Typed text is attributable to the local writer; pasted and programmatic text is not.
    const source = transactions.length && transactions.every((transaction) => transaction.isUserEvent("input.type")) ? "human" : "unknown";
    const changes = [];
    update.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => changes.push({ from, to, insert: inserted.toString() }));
    try {
      const result = applyChanges(record, changes, source);
      if (result.text !== update.state.doc.toString()) throw new Error("编辑结果与记录不一致");
      this.records[path] = result;
      this.changed();
    } catch (error) {
      console.error("文字来源：编辑未记录", error);
      new Notice("文字来源记录与笔记不一致，已隐藏标识。");
    }
  }

  async applyCodexChanges(request) {
    let applied = false;
    try {
      if (this.readOnly || !request || typeof request.path !== "string" || typeof request.expected !== "string") throw new Error("请求无效");
      const path = request.path;
      const record = this.record(path);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!record || !(file instanceof TFile) || file.extension.toLowerCase() !== "md") throw new Error("笔记未启用文字来源记录");
      if (record.text !== request.expected) throw new Error("笔记与文字来源记录不一致，请先检查未保存或外部修改");
      const result = applyChanges(record, request.changes, "ai");
      const editors = this.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view)
        .filter((view) => view.file?.path === path && view.editor);
      if (editors.some((view) => view.editor.getValue() !== record.text)) throw new Error("打开的编辑器中有尚未记录的修改");
      if (editors.length) {
        const editor = editors[0].editor;
        this.applying = true;
        try {
          for (const change of [...request.changes].sort((a, b) => b.from - a.from || b.to - a.to)) {
            editor.replaceRange(change.insert, editor.offsetToPos(change.from), editor.offsetToPos(change.to));
          }
          if (editor.getValue() !== result.text) throw new Error("编辑器返回了不同的文字");
        } catch (error) {
          // Never attribute a partially applied edit to anyone.
          applied = editor.getValue() !== record.text;
          this.records[path] = { text: editor.getValue(), spans: [] };
          this.changed();
          throw error;
        } finally { this.applying = false; }
      } else {
        await this.app.vault.process(file, (text) => {
          if (text !== record.text) throw new Error("文件在修改前发生了变化");
          return result.text;
        });
      }
      applied = true;
      this.records[path] = result;
      this.changed();
      await this.persist();
      return { ok: true, path, changes: request.changes.length };
    } catch (error) {
      return { ok: false, applied, error: error?.message || String(error) };
    }
  }

  rename(oldPath, newPath, folder) {
    const paths = Object.keys(this.records).filter((path) => path === oldPath || (folder && path.startsWith(`${oldPath}/`)));
    if (paths.some((path) => this.records[newPath + path.slice(oldPath.length)])) {
      if (paths.length) new Notice("文字来源记录存在同名路径，请手动检查。");
      return;
    }
    for (const path of paths) {
      this.records[newPath + path.slice(oldPath.length)] = this.records[path];
      delete this.records[path];
    }
    if (paths.length) this.changed();
  }

  removed(path, folder) {
    let changed = false;
    for (const [name, record] of Object.entries(this.records)) {
      if (name === path || (folder && name.startsWith(`${path}/`))) { record.inactive = true; changed = true; }
    }
    if (changed) this.changed();
  }

  refreshStatus() {
    if (!this.statusButton) return;
    const file = this.app.workspace.getActiveFile();
    const path = isMarkdown(file) ? file.path : null;
    const record = path && this.record(path);
    const editor = this.app.workspace.activeLeaf?.view?.editor;
    const stale = record && editor && editor.getValue() !== record.text;
    const inactive = path && this.records[path] && !record;
    const untracked = path && editor && !this.records[path];
    this.statusButton.setText(this.readOnly ? "文字来源：不可用" : stale || inactive ? "文字来源：待检查" : untracked ? "文字来源：未记录" : this.visible ? "文字来源：显示" : "文字来源：隐藏");
    this.statusButton.title = this.readOnly ? "无法读取文字来源数据文件" : stale || inactive ? "记录与当前笔记不一致，点击可重新开始" : untracked ? "点击开始记录此笔记，已有文字来源未知" : "点击显示或隐藏。紫色：AI；绿色：我；橙色：共同修改；未标记：未知";
  }

  changed() {
    this.refreshStatus();
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      for (const entry of this.views) {
        try { entry.view.dispatch({ effects: this.refreshEffect.of(null) }); }
        catch (error) { console.error("文字来源：刷新失败", error); }
      }
    }, 0);
    if (!this.readOnly) {
      if (this.saveTimer) window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => { this.saveTimer = null; this.persist().catch(() => {}); }, 500);
    }
  }

  persist() {
    if (this.readOnly) return Promise.resolve();
    this.pendingSave = true;
    if (this.savePromise) return this.savePromise;
    this.savePromise = (async () => {
      while (this.pendingSave) {
        this.pendingSave = false;
        const data = JSON.stringify({ version: 1, visible: this.visible, records: this.records, archives: this.archives }, null, 2);
        await this.app.vault.adapter.write(ORIGIN_DATA_PATH, data);
      }
    })().catch((error) => {
      console.error("文字来源：保存失败", error);
      new Notice("文字来源记录保存失败，请检查插件数据文件。");
      throw error;
    }).finally(() => { this.savePromise = null; });
    return this.savePromise;
  }

  unload() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    if (!this.readOnly) this.persist().catch(() => {});
  }
}

class NoteActivityPlugin extends Plugin {
  async onload() {
    this.ledger = new ActivityLedger(await this.loadData());
    this.saveTimer = null;
    this.savePromise = null;
    this.savePending = false;
    this.lastToday = dayKey(Date.now());
    this.lastEntry = OWNED_VIEW_TYPE;
    this.textOrigin = new TextOrigin(this);
    await this.textOrigin.load();
    this.textOrigin.install();
    this.floatingTopicMaps = new FloatingTopicMaps(this);
    this.noteTabColors = new NoteTabColors(this);
    this.fileExplorerOpenTabs = new FileExplorerOpenTabs(this);
    this.registerInterval(window.setInterval(() => this.fileExplorerOpenTabs.refreshDecks(), 5000));
    this.refreshTabIndicators = () => this.fileExplorerOpenTabs.refresh(this.noteTabColors.refresh());
    for (const event of ["layout-change", "active-leaf-change", "file-open"]) {
      this.registerEvent(this.app.workspace.on(event, () => { this.floatingTopicMaps.sync(); this.refreshTabIndicators(); }));
    }
    for (const event of ["changed", "resolved"]) {
      this.registerEvent(this.app.metadataCache.on(event, () => { this.floatingTopicMaps.refresh(); this.refreshTabIndicators(); }));
    }
    this.registerEvent(this.app.vault.on("rename", this.refreshTabIndicators));
    this.registerEvent(this.app.workspace.on("editor-change", (_editor, view) => {
      if (view.file?.path === TODO_LIST_PATH) void this.fileExplorerOpenTabs.refreshTasks();
    }));
    for (const event of ["create", "modify", "delete", "rename"]) {
      this.registerEvent(this.app.vault.on(event, (file, oldPath) => {
        if (file.path === TODO_LIST_PATH || oldPath === TODO_LIST_PATH) void this.fileExplorerOpenTabs.refreshTasks();
      }));
    }
    this.app.workspace.onLayoutReady(() => { this.floatingTopicMaps.sync(); this.refreshTabIndicators(); });
    this.addCommand({ id: "toggle-floating-topic-map", name: "切换悬浮知识地图", callback: () => {
      const leaf = this.app.workspace.activeLeaf;
      if (leaf?.view.getViewType() === "markdown") this.floatingTopicMaps.toggle(leaf);
    } });
    if (Platform.isDesktopApp) {
      this.addCommand({
        id: "toggle-right-sidebar",
        name: "切换右侧边栏",
        hotkeys: [{ modifiers: ["Mod", "Shift"], key: "S" }],
        callback: () => this.toggleReadingSidebar(),
      });
      this.addCommand({
        id: "toggle-review-focus",
        name: "切换左右窗格焦点",
        hotkeys: [{ modifiers: ["Mod", "Shift"], key: "Enter" }],
        checkCallback: (checking) => this.moveHorizontalFocus(checking),
      });
      for (const [direction, name, key] of [
        ["left", "聚焦左侧窗格", "ArrowLeft"],
        ["right", "聚焦右侧窗格", "ArrowRight"],
      ]) {
        this.addCommand({
          id: `focus-pane-${direction}`,
          name,
          hotkeys: Platform.isMacOS ? [{ modifiers: ["Ctrl", "Mod"], key }] : undefined,
          checkCallback: (checking) => this.moveHorizontalFocus(checking, direction),
        });
      }
      this.app.workspace.onLayoutReady(() => {
        this.moveRibbonToRightSidebar();
        this.syncSidebarMotion();
        if (Platform.isMacOS) this.hideMacWindowButtons();
      });
    }

    this.registerView(VIEW_TYPE, (leaf) => new NoteActivityView(leaf, this));
    this.registerView(OWNED_VIEW_TYPE, (leaf) => new PersonalItemsView(leaf, this));
    this.registerView(TODO_VIEW_TYPE, (leaf) => new TodoView(leaf, this));
    this.registerView(VOCABULARY_VIEW_TYPE, (leaf) => new VocabularyWorkbenchView(leaf, this));
    this.registerView(LEARNING_VIEW_TYPE, (leaf) => new LearningScheduleView(leaf, this));
    this.registerView(TALK_VIEW_TYPE, (leaf) => new TalkReviewView(leaf, this));
    this.addCommand({ id: "open-talk-review", name: "打开演讲回看", callback: () => this.openView(TALK_VIEW_TYPE) });
    this.addCommand({ id: "open-learning-schedule", name: "打开学习日程", callback: () => this.openView(LEARNING_VIEW_TYPE) });
    this.registerView(TOPICS_VIEW_TYPE, (leaf) => new KnowledgeTopicsView(leaf, this));
    this.addRibbonIcon("layout-dashboard", "个人工作台", () => this.openView(this.lastEntry));
    this.addCommand({ id: "open-portal", name: "打开个人工作台", callback: () => this.openView(this.lastEntry) });
    this.addCommand({ id: "open", name: "打开笔记动态", callback: () => this.openView() });
    this.addCommand({ id: "open-personal-items", name: "打开个人物品", callback: () => this.openView(OWNED_VIEW_TYPE) });
    this.addCommand({ id: "open-todo", name: "打开待办事项", callback: () => this.openView(TODO_VIEW_TYPE) });
    this.addCommand({ id: "open-vocabulary", name: "打开词汇内化", callback: () => this.openView(VOCABULARY_VIEW_TYPE) });
    this.addCommand({ id: "open-knowledge-topics", name: "打开知识主题", callback: () => this.openView(TOPICS_VIEW_TYPE) });

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => {
        if (!isActivityFile(file)) return;
        this.ledger.create(file, Date.now());
        this.changed();
      }));
      this.registerEvent(this.app.vault.on("modify", (file) => {
        if (!isActivityFile(file)) return;
        this.ledger.modify(file, Date.now());
        this.changed();
      }));
      this.registerEvent(this.app.vault.on("delete", (file) => {
        if (isMarkdown(file) || file instanceof TFolder) {
          this.ledger.remove(file.path, file instanceof TFolder);
          this.changed();
        }
      }));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFolder) this.ledger.rename(oldPath, file.path, true);
        else if (isMarkdown(file) || oldPath.toLowerCase().endsWith(".md")) {
          this.ledger.rename(oldPath, file.path, false);
          if (isActivityFile(file) && !oldPath.toLowerCase().endsWith(".md")) this.ledger.create(file, Date.now());
          else if (isActivityFile(file)) this.ledger.data.snapshot[file.path] = fileStats(file);
          else this.ledger.remove(file.path);
        } else return;
        this.changed();
      }));

      this.ledger.reconcile(this.app.vault.getMarkdownFiles().filter(isActivityFile), Date.now());
      this.changed();
    });

    this.registerInterval(window.setInterval(() => {
      const today = dayKey(Date.now());
      if (today === this.lastToday) return;
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (leaf.view instanceof NoteActivityView && leaf.view.selectedDay === this.lastToday) {
          leaf.view.selectedDay = today;
        }
      }
      this.lastToday = today;
      void this.fileExplorerOpenTabs.refreshTasks();
      this.refreshViews();
    }, 60000));
  }

  moveHorizontalFocus(checking, direction) {
    const { workspace } = this.app;
    const current = workspace.activeLeaf?.isVisible() ? workspace.activeLeaf : workspace.getMostRecentLeaf();
    if (!current?.isVisible()) return false;
    const from = current.containerEl.getBoundingClientRect();
    const neighbors = {};

    workspace.iterateAllLeaves((leaf) => {
      const el = leaf.containerEl;
      if (leaf === current || el.ownerDocument !== current.containerEl.ownerDocument ||
          leaf.getRoot().collapsed || !leaf.isVisible()) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= from.top || rect.top >= from.bottom) return;

      const leftGap = from.left - rect.right;
      const rightGap = rect.left - from.right;
      const gap = Math.max(leftGap, rightGap);
      if (gap < -1) return;
      const side = leftGap > rightGap ? "left" : "right";
      const best = neighbors[side];
      if (!best || gap < best.gap - 1 ||
          (Math.abs(gap - best.gap) <= 1 && leaf.activeTime > best.leaf.activeTime)) {
        neighbors[side] = { leaf, gap };
      }
    });

    const left = neighbors.left?.leaf;
    const right = neighbors.right?.leaf;
    const mostRecent = left && (!right || left.activeTime > right.activeTime) ? left : right;
    const target = direction ? neighbors[direction]?.leaf : mostRecent;
    if (!target) return false;
    if (!checking) workspace.setActiveLeaf(target, { focus: true });
    return true;
  }

  toggleReadingSidebar() {
    const workspace = this.app.workspace;
    const { leftSplit, rightSplit } = workspace;
    if (!rightSplit.collapsed) {
      rightSplit.collapse();
      if (this.sidebarExchange) leftSplit.expand();
      this.restoreReviewNote();
      return;
    }
    this.showReadingSidebar();
    if (workspace.getMostRecentLeaf(rightSplit)?.getViewState().type === FLASHCARD_VIEW_TYPE) {
      void this.openReviewScratch().catch((error) => new Notice(error.message));
    }
  }

  async openReviewScratch() {
    const { workspace, vault } = this.app;
    const { rootSplit, rightSplit } = workspace;
    const file = vault.getFileByPath(REVIEW_SCRATCH_PATH) ?? await vault.create(REVIEW_SCRATCH_PATH, "");
    if (rightSplit.collapsed) return;

    const previous = workspace.getMostRecentLeaf(rootSplit);
    let scratch = workspace.getLeavesOfType("markdown").find((leaf) =>
      leaf.getRoot() === rootSplit && (leaf.view.file?.path ?? leaf.getViewState().state?.file) === file.path
    );
    if (!scratch) {
      scratch = workspace.createLeafInTabGroup(previous?.parent);
      await scratch.openFile(file, { state: { mode: "source" } });
    } else {
      const state = scratch.getViewState();
      if (state.state?.mode === "preview") await scratch.setViewState({ ...state, state: { ...state.state, mode: "source" } });
    }
    if (previous !== scratch) this.reviewPreviousLeaf = previous;
    if (rightSplit.collapsed) {
      this.restoreReviewNote();
    } else {
      await workspace.revealLeaf(scratch);
      workspace.setActiveLeaf(scratch, { focus: true });
    }
  }

  restoreReviewNote() {
    const { workspace } = this.app;
    const { rootSplit } = workspace;
    const previous = this.reviewPreviousLeaf;
    this.reviewPreviousLeaf = null;
    const current = workspace.getMostRecentLeaf(rootSplit);
    if (previous?.getRoot() === rootSplit && current?.view.file?.path === REVIEW_SCRATCH_PATH) {
      workspace.setActiveLeaf(previous, { focus: true });
    }
  }

  showReadingSidebar() {
    const workspace = this.app.workspace;
    const { leftSplit, rightSplit, rootSplit } = workspace;
    if (!leftSplit.collapsed) {
      if (!this.sidebarExchange) {
        const view = workspace.getMostRecentLeaf(rootSplit)?.view;
        const rail = view?.contentEl?.querySelector(":scope > .ce-rail");
        this.sidebarExchange = { leftWidth: leftSplit.size, rightWidth: rightSplit.size };
        rightSplit.setSize(leftSplit.size + (rail?.offsetWidth ?? rightSplit.size));
      }
      leftSplit.collapse();
    }
    rightSplit.expand();
  }

  restoreSidebarExchange() {
    if (!this.sidebarExchange) return;
    const { rightWidth } = this.sidebarExchange;
    this.sidebarExchange = null;
    const workspace = this.app.workspace;
    workspace.leftSplit.expand();
    workspace.rightSplit.setSize(rightWidth);
    workspace.requestResize();
    workspace.requestSaveLayout();
  }

  moveRibbonToRightSidebar() {
    const workspace = this.app.workspace;
    const ribbon = workspace.leftRibbon?.containerEl;
    const sidebar = workspace.rightSplit?.containerEl;
    const originalParent = ribbon?.parentNode;
    if (!originalParent || !sidebar) return;

    const originalNext = ribbon.nextSibling;
    const mount = () => {
      if (sidebar.firstChild !== ribbon) sidebar.prepend(ribbon);
    };
    ribbon.classList.add("workbench-right-ribbon");
    mount();
    const layoutEvent = workspace.on("layout-change", mount);
    this.register(() => {
      workspace.offref(layoutEvent);
      ribbon.classList.remove("workbench-right-ribbon");
      const anchor = originalNext?.parentNode === originalParent ? originalNext : null;
      originalParent.insertBefore(ribbon, anchor);
    });
  }

  hideMacWindowButtons() {
    const workspace = this.app.workspace;
    const windows = new Map();
    const hide = (targetWindow) => {
      if (!targetWindow || windows.has(targetWindow)) return;
      const nativeWindow = targetWindow.electronWindow;
      if (typeof nativeWindow?.setWindowButtonVisibility !== "function") return;
      const apply = () => nativeWindow.setWindowButtonVisibility(false);
      apply();
      windows.set(targetWindow, { nativeWindow, apply });
      targetWindow.addEventListener("focus", apply);
    };

    hide(window);
    workspace.iterateAllLeaves((leaf) => hide(leaf.containerEl.ownerDocument.defaultView));
    this.registerEvent(workspace.on("window-open", (_workspaceWindow, targetWindow) => hide(targetWindow)));
    this.registerEvent(workspace.on("window-close", (_workspaceWindow, targetWindow) => {
      const entry = windows.get(targetWindow);
      if (!entry) return;
      targetWindow.removeEventListener("focus", entry.apply);
      windows.delete(targetWindow);
    }));
    this.register(() => {
      for (const [targetWindow, { nativeWindow, apply }] of windows) {
        targetWindow.removeEventListener("focus", apply);
        if (!nativeWindow.isDestroyed()) nativeWindow.setWindowButtonVisibility(true);
      }
    });
  }

  syncSidebarMotion() {
    const { containerEl, leftSplit, rightSplit, rootSplit } = this.app.workspace;
    const dock = rightSplit.containerEl;
    const root = rootSplit.containerEl;
    const update = () => {
      const visibleWidth = dock.getBoundingClientRect().width;
      if (rightSplit.collapsed && this.reviewPreviousLeaf) this.restoreReviewNote();
      if (this.sidebarExchange && rightSplit.collapsed) {
        leftSplit.expand();
        if (visibleWidth < 0.05) this.restoreSidebarExchange();
      }

      const borrowedWidth = this.sidebarExchange?.leftWidth ?? 0;
      const visibleLeftWidth = borrowedWidth ? leftSplit.containerEl.getBoundingClientRect().width : 0;
      const expandedWidth = rightSplit.size - borrowedWidth;
      // Measure the original space for the article, accounting for the width loaned by the file dock.
      const combinedWidth = root.getBoundingClientRect().width + visibleWidth + visibleLeftWidth - borrowedWidth;
      containerEl.style.setProperty("--ce-combined-width", `${combinedWidth.toFixed(2)}px`);
      containerEl.style.setProperty("--ce-sidebar-width", `${expandedWidth}px`);
      const railHidden = !rightSplit.collapsed && rightSplit.size - visibleWidth < 0.05;
      containerEl.style.setProperty("--ce-sidebar-rail-visibility", railHidden ? "hidden" : "visible");
      containerEl.classList.toggle("ce-slide-article", expandedWidth > 0 && combinedWidth - expandedWidth >= 900);
    };
    const dockObserver = new MutationObserver(update);
    dockObserver.observe(dock, { attributes: true, attributeFilter: ["class", "style"] });
    const rootObserver = new ResizeObserver(update);
    rootObserver.observe(root);
    update();
    this.register(() => {
      dockObserver.disconnect();
      rootObserver.disconnect();
      containerEl.classList.remove("ce-slide-article");
      for (const property of ["--ce-combined-width", "--ce-sidebar-width", "--ce-sidebar-rail-visibility"]) {
        containerEl.style.removeProperty(property);
      }
    });
  }

  async openView(viewType = VIEW_TYPE) {
    this.lastEntry = viewType;
    const expectedView = viewType === TALK_VIEW_TYPE ? TalkReviewView : viewType === LEARNING_VIEW_TYPE ? LearningScheduleView : viewType === TOPICS_VIEW_TYPE ? KnowledgeTopicsView : viewType === TODO_VIEW_TYPE ? TodoView : viewType === OWNED_VIEW_TYPE ? PersonalItemsView : viewType === VOCABULARY_VIEW_TYPE ? VocabularyWorkbenchView : NoteActivityView;
    const candidates = this.app.workspace.getLeavesOfType(viewType);
    let leaf = candidates.find((candidate) => candidate.view instanceof expectedView);
    if (!leaf) {
      leaf = candidates[0];
      if (leaf) await leaf.setViewState({ type: "empty", active: false });
      else leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: viewType, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async switchView(leaf, viewType) {
    this.lastEntry = viewType;
    await leaf.setViewState({ type: viewType, active: true });
  }

  changed() {
    this.refreshViews();
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 500);
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof NoteActivityView) leaf.view.render();
    }
  }

  async saveTopicParents(parents) {
    if (this.savingTopicParents) throw new Error("另一次主题层级保存正在进行，请稍后重试");
    this.savingTopicParents = true;
    const previous = this.ledger.data.topicParents;
    this.ledger.data.topicParents = { ...parents };
    try {
      if (await this.persist() === false) throw new Error("无法写入插件数据文件");
      for (const leaf of this.app.workspace.getLeavesOfType(TOPICS_VIEW_TYPE)) leaf.view.refresh?.();
      this.floatingTopicMaps?.refresh();
      this.refreshTabIndicators?.();
    } catch (error) {
      if (previous === undefined) delete this.ledger.data.topicParents;
      else this.ledger.data.topicParents = previous;
      throw error;
    } finally {
      this.savingTopicParents = false;
    }
  }

  async updateTalkSlideMarker(entry, remove) {
    if (this.savingTalkMarker) throw new Error("另一次补标保存正在进行");
    this.savingTalkMarker = true;
    const previous = this.ledger.data.talkSlideMarkers;
    const entries = (previous?.[TALK_ID] ?? []).filter(({ startMs }) => startMs !== entry.startMs);
    if (!remove) entries.push(entry);
    entries.sort((a, b) => a.startMs - b.startMs);
    this.ledger.data.talkSlideMarkers = { ...previous, [TALK_ID]: entries };
    try {
      if (await this.persist() === false) throw new Error("无法写入插件数据文件");
    } catch (error) {
      if (previous === undefined) delete this.ledger.data.talkSlideMarkers;
      else this.ledger.data.talkSlideMarkers = previous;
      throw error;
    } finally {
      this.savingTalkMarker = false;
    }
  }

  async saveTalkPassageExtra(key, markdown, original) {
    if (this.savingTalkPassageExtra) throw new Error("正在保存另一段内容，请稍后再试。");
    const previous = this.ledger.data.talkPassageExtras;
    const passages = { ...previous?.[TALK_ID] };
    if ((passages[key] ?? "") !== original) throw new Error("这段内容已在其他标签页更新，请保留草稿后重新打开讲稿。");
    if (markdown === original) return;
    if (markdown) passages[key] = markdown;
    else delete passages[key];
    const extras = { ...previous };
    if (Object.keys(passages).length) extras[TALK_ID] = passages;
    else delete extras[TALK_ID];

    this.savingTalkPassageExtra = true;
    if (Object.keys(extras).length) this.ledger.data.talkPassageExtras = extras;
    else delete this.ledger.data.talkPassageExtras;
    try {
      if (await this.persist() === false) throw new Error("无法保存段落补充内容。");
    } catch (error) {
      if (previous === undefined) delete this.ledger.data.talkPassageExtras;
      else this.ledger.data.talkPassageExtras = previous;
      throw error;
    } finally {
      this.savingTalkPassageExtra = false;
    }
  }

  persist() {
    this.savePending = true;
    if (this.savePromise) return this.savePromise;
    this.savePromise = (async () => {
      while (this.savePending) {
        this.savePending = false;
        await this.saveData(JSON.parse(JSON.stringify(this.ledger.data)));
      }
    })().catch((error) => {
      console.error("笔记动态：保存记录失败", error);
      new Notice("笔记动态记录保存失败，请检查插件数据文件。");
      return false;
    }).finally(() => { this.savePromise = null; });
    return this.savePromise;
  }

  onunload() {
    this.restoreSidebarExchange();
    this.fileExplorerOpenTabs?.destroy();
    this.noteTabColors?.destroy();
    this.floatingTopicMaps?.destroy();
    this.textOrigin?.unload();
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.persist();
  }
}

module.exports = NoteActivityPlugin;
module.exports.ActivityLedger = ActivityLedger;
module.exports.dayKey = dayKey;
module.exports.shiftDay = shiftDay;
module.exports.ownedItem = ownedItem;
module.exports.sockPairs = sockPairs;
module.exports.clothingCategories = clothingCategories;
module.exports.filterOwnedItems = filterOwnedItems;
module.exports.trashOwnedItem = trashOwnedItem;
module.exports.DeletePersonalItemModal = DeletePersonalItemModal;
module.exports.TextOrigin = TextOrigin;
module.exports.validOriginRecord = validRecord;
module.exports.setTextOrigin = setOrigin;
module.exports.applyOriginChanges = applyChanges;
module.exports.knowledgeTopics = knowledgeTopics;
module.exports.KnowledgeTopicsView = KnowledgeTopicsView;
module.exports.topicHierarchy = topicHierarchy;
module.exports.TopicGraphEditor = TopicGraphEditor;

module.exports.learningNoteTags = learningNoteTags;
module.exports.learningMapZoom = learningMapZoom;

module.exports.learningMapPosition = learningMapPosition;
module.exports.learningDemoDays = learningDemoDays;

module.exports.topicGraphLayout = topicGraphLayout;
module.exports.topicNodeTone = topicNodeTone;

module.exports.topicDropParent = topicDropParent;

module.exports.topicGroupBounds = topicGroupBounds;

module.exports.unplannedTopicParents = unplannedTopicParents;

module.exports.TopicNotesModal = TopicNotesModal;

module.exports.FloatingTopicMaps = FloatingTopicMaps;

module.exports.localTopicNotes = localTopicNotes;
module.exports.LocalTopicMap = LocalTopicMap;

module.exports.openNoteTab = openNoteTab;

module.exports.NoteTabColors = NoteTabColors;
module.exports.noteTagColor = noteTagColor;
