# Obsidian 配置包

[下载 obsidian-config.zip](https://github.com/cuiliangruihai/obsidian-config/releases/latest/download/obsidian-config.zip)

这套配置包含当前的主题、CSS 片段、快捷键、侧栏布局、核心插件设置和社区插件配置。默认主题是 Claude Editorial。配置包自带 16 个插件，包含个人工作台、浮动草稿纸和 FSRS-7 闪卡插件。12 个插件在原库启用且随包分发。另有 5 个社区插件可按需补装。

## 安装

1. 下载并解压 ZIP。
2. 新建试用库时，在 Obsidian 选择「打开文件夹作为库」，选中解压出的 `obsidian-config` 文件夹。要应用到已有库，先退出 Obsidian，备份已有的 `.obsidian`，再将解压目录中的 `.obsidian` 复制到库根目录。macOS Finder 可按 `Cmd+Shift+.` 显示隐藏文件。
3. 重新打开库。在「设置 → 第三方插件」里确认信任后关闭受限模式。若插件未自动开启，可在已安装列表中手动启用。
4. 在「设置 → 外观」里可切换 Claude Editorial、Claude Warm、Maple、Minimal 或 Phycat。Claude Editorial 公开版使用系统字体。建议使用 Obsidian 1.14.4 或更新版本，部分插件仅支持桌面端。

更多配置目录和插件说明见 [Obsidian 官方帮助](https://obsidian.md/help/configuration-folder)和[第三方插件说明](https://obsidian.md/help/Extending%2BObsidian/Community%2Bplugins)。

## 补装插件

下列 5 个插件的可复用设置已随包提供。要启用它们，在「设置 → 第三方插件 → 浏览」搜索、安装并开启。

| 插件 | 上游 |
| --- | --- |
| Highlightr | [发布页](https://github.com/chetachiezikeuzor/Highlightr-Plugin/releases) |
| Excalidraw | [发布页](https://github.com/zsviczian/obsidian-excalidraw-plugin/releases) |
| Markmind | [发布页](https://github.com/markmindckm/obsidian-markmind/releases) |
| Style Settings | [发布页](https://github.com/obsidian-community/obsidian-style-settings/releases) |
| Templater | [发布页](https://github.com/SilentVoid13/Templater/releases) |

[完整插件清单](plugins.json)记录了原库的版本与启用状态。Git、Inscribe、Claudian 和 Wechat Converter 随包提供，默认关闭。Pandoc、AI 服务、账户和同步按自己的环境配置。Templater 的新建笔记模板位于库内 `Templates/New Note.md`，使用前请创建该模板或在插件设置里选择自己的模板。

## 自定义功能

- 个人工作台的笔记动态和文字来源从空记录开始。「知识主题」读取 `knowledge/`，「个人物品」读取 `What I Own/`，两个目录可按需创建。「词汇内化」和「演讲回看」需要各自的本地服务或资料。功能见[个人工作台说明](.obsidian/plugins/note-activity/README.md)。
- 草稿纸使用 `Cmd/Ctrl+Shift+Y` 打开。草稿保存在使用者本机。
- Spaced Repetition 是 FSRS-7 定制版，支持库内独立计划文件 `Spaced Repetition/schedule-data.sr.md`。首次使用时从空记录开始。社区插件更新可能替换此版本。已有复习数据时，请先备份并在试用库确认格式兼容。[上游插件](https://github.com/st3v3nmw/obsidian-spaced-repetition) · [独立计划文件改动](https://github.com/st3v3nmw/obsidian-spaced-repetition/pull/1579)

笔记、附件、最近打开的文件、浏览书签、文字来源快照、复习记录、账号和凭据留在原库。第三方插件和主题的许可证位于各自目录。
