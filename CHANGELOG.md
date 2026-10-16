# 更新日志

本仓库为 **ZFX Emperor** 的二改版。上游变更历史请见
[ZFXing-lite/zfx-emperor](https://github.com/ZFXing-lite/zfx-emperor)。

---

## 0.2.0-mod.1

基于上游 `0.2.0`（commit `8237621`）的二改。目标：在 **DSH 0.2.0-rc.2** 上可安装、可加载、可生效。

### 修复

- **`cordis.patch.yml`：改为合法的 loader patch 数组格式**（致命）
  上游写成 YAML 映射（顶层 `zfx-emperor:` 键），DSH 的 `parsePatchList()` 要求顶层为数组，
  导致安装校验失败并**整体回滚** —— 这是「装不上」的直接原因。
  现改为 `- insert:` 插入插件行、配置挂在行的 `config` 下。

- **`lib/profile-tool.js`：修正宿主服务名**
  `ctx.tool` → `ctx.tools.register`。宿主 `@deepseek-ai/dsh-tools` 注册的是复数 `tools`；
  取未在 `inject` 声明的属性会抛 `cannot get property X without inject`，导致插件激活失败。

- **`client.js`：改为 DSH 要求的经典脚本制式**
  上游用 ESM（`export …`），而 client 插件加载器按经典脚本执行并要求
  `window.__ModuleLoader__.load({ id, factory })`，原写法抛
  `SyntaxError: Unexpected token 'export'`，宿主报 `1 entry did not activate`。
  现重写为 `__ModuleLoader__.load()` 包装（内部 ES5），并补上卸载清理。

- **`install.ps1`：profile 自动探测**
  不再写死 `web`；唯一 profile 直接用，多个时优先 `desktop`、其次 `web`，否则列出候选要求显式指定。

### 文档

- `index.js`：在 `inject` 声明处补充注释，说明服务名必须与宿主注册名一致（无行为变更）。
- 新增 `MOD-NOTES.md`：完整二改说明与验证记录。
- 新增 `CHANGELOG.md`：本文件。

### 未改动

`prompts/square.md`（persona 正文）、`lib/patcher.js`（引擎补丁逻辑）及
其余 lib 文件与上游逐字节一致。本二改只修适配问题，不改设计。

### 验证

DSH `0.2.0-rc.2` / Node `v24.21.0`：

- `loadOverlayPatches` → 数组解析通过，entries = 1
- `loadProfileDirectory` → `skippedBundles: []`，插件层 LOADED
- `composeEntries` → 插件行进入配置树，config 完整
- `import(index.js)` → `apply` 可加载
- `pnpm install` → 退出码 0
