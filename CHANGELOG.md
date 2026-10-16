# 更新日志

本仓库为 **ZFX Emperor** 的二改版。上游变更历史请见
[ZFXing-lite/zfx-emperor](https://github.com/ZFXing-lite/zfx-emperor)。

---

## 0.2.0-mod.4

### 修复

- **`index.js`：引擎层写入只读 app.asar 导致插件激活失败**（致命，「一直出错」的第三个原因）

  官方桌面版把整个 DSH 打进 `resources/app.asar` —— 它是单个归档文件，
  里面的路径可读但**不可写**。`ensureApprovalBypass()` 在 `apply()` 里
  同步调用且未捕获异常，于是打补丁失败直接把插件带崩：

  ```
  启用失败: dsh: warning: 1 entry did not activate
  zfx-emperor: Error: ENOENT: no such file or directory,
  copyFile '...\Temp\xxxx.tmp.js' ->
  '...\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-user-approval\lib\index.js.zfx.bak'
  at ensureApprovalBypass (lib/patcher.js:75)
  ```

- **改为「主功能优先、增强全部可选」的稳健结构**

  - `apply()` 内每一步都用 `safe()` 包裹：任何一步抛异常都只跳过该步，
    不再让整个插件激活失败
  - `patchEngine` 默认值 `true` → **`false`**（需要时显式传 `true`）
  - `lib/patcher.js`：新增 `isInsideAsar()`，命中只读归档时**提前跳过**，
    连写入尝试都不发起；`detectEngineState()` / `ensureApprovalBypass()`
    全程不抛异常
  - `lib/identity-strip.js`：三个导出全部加异常保护，单个文件失败不影响其他
  - `index.js`：`PROMPT_TEXT` 在模块加载期读取 persona 文件，改为失败降级为空串
    （原先若读取失败，插件在 import 阶段就挂了，连 `apply()` 都进不去）
  - 测试 `defaults when empty` / `override merges` 同步更新

  > 设计原则：本插件真正必需的只有「persona 注入」与「工具注册」两件事。
  > 引擎补丁、身份剥离、监听器、评分器都属于可选增强，**任何一个坏掉都不应
  > 影响插件装上**。

### 验证

- **抗异常激活测试**：构造 9 种异常宿主（`systemPrompt` 缺失 / `section` 抛异常 /
  `effect` 抛异常 / `tools.register` 抛异常 / `ctx.on` 抛异常 / 服务全缺 /
  `ctx` 为空对象 / 只读环境下强制 `patchEngine:true` / `stripIdentity:true`）
  —— **9/9 全部 `apply()` 不抛异常**
- **只读 app.asar 场景**：真实构造 `resources/app.asar/dsh/node_modules/...` 结构，
  确认 `writable` 判定为 `false`、补丁被跳过、目标文件未被改动、未产生 `.zfx.bak`
- 插件自带测试 12/12 通过

---

## 0.2.0-mod.3

### 修复

- **`lib/profile-tool.js`：工具注册缺少 `output` 声明，导致整个插件激活失败**（致命）

  DSH 0.2.0-rc.2 的 `@deepseek-ai/dsh-tools` 在 `register()` 里强制校验：

  ```js
  // dsh-tools/lib/index.js:2881
  if (output === void 0 || typeof output !== "object" ||
      typeof output.render !== "function" ||
      output.presentationMeta !== void 0 && typeof output.presentationMeta !== "function")
    throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`);
  ```

  原定义只有 `name` / `description` / `parameters` / `execute`，没有 `output`，
  于是注册直接抛 `TypeError`。该异常发生在 `apply()` 阶段，会让**整个插件**
  激活失败：

  ```
  组件启用失败: dsh: warning: 1 entry did not activate
  zfx-emperor (zfx-emperor): TypeError: tool "emperor_profile" must declare
  output { schema, render, presentationMeta? } at Proxy.register
  ```

  现补上 `output`：

  ```js
  output: {
    schema: { type: "string" },
    render: (_args, value) => [
      { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
    ],
  },
  ```

  同时 `execute()` 改为直接返回 JSON 字符串（与 `output.schema` 的 `type: "string"` 一致），
  不再返回旧的 `{ content: [...] }` 包裹结构。

  > 说明：mod.1 修的是 `cordis.patch.yml` 格式与 `ctx.tool` → `ctx.tools`，
  > 当时漏掉了 `output` 这一项。所以此前版本在 DSH 0.2.0-rc.2 上**仍然装不上**——
  > 这正是社区反馈「装了没反应 / 组件启用失败」的直接原因。

- 版本号统一为 `0.2.0-mod.3`（`package.json` 的 `version` 与 `dsh.version`、
  `index.js` 与 `lib/profile-tool.js` 里的运行期版本串原本停在 `0.2.0`）。

---

## 0.2.0-mod.2

### 修复

- **`install.ps1`：脚本删掉自身导致插件目录被清空**（致命，「装不上」的第二个原因）

  原逻辑是「先 `Remove-Item -Recurse -Force $target`，再 `Copy-Item -Recurse -Force $here $target`」。
  当**脚本所在目录恰好就是目标目录**时（用户按 README 方式二把仓库放进
  `~/.dsh/plugins/zfx-emperor`，再在该目录里执行 `install.ps1`），
  第一步删除的就是脚本自己所在目录，第二步的复制源随即不存在 → 抛错退出。
  结果是插件目录被清空、`package.json` 一并消失，宿主读取插件元信息时崩溃：

  ```
  包元信息错误：Plugin metadata for zfx-emperor: Error:
  ...\.dsh\plugins\zfx-emperor\package.json:
  ENOENT: no such file or directory
  ```

  现在脚本会先比对源目录与目标目录（含父子嵌套关系），一旦判定为同一位置就
  **跳过复制**并给出提示，不再误删。正常「克隆在别处 → 运行脚本」的流程不受影响。

- **`README.md`：安装说明重写 + 新增故障排查**

  - 新增「方式一：标准安装（推荐）」——直接用
    `github:Sakura42141/zfx-emperor` 作为依赖。这条路不经过
    `~/.dsh/plugins/`，由包管理器维护 `node_modules` 里的实际副本，
    从根上避开 `link:` 悬空导致的 ENOENT。已实测可用。
  - 原安装脚本降为「方式二」，原手动安装降为「方式三」。
  - 新增「故障排查：报 `package.json: ENOENT`」小节，说明该报错的含义
    （profile 声明了 `link:`，但目标目录里没有 `package.json`）
    并给出两种修复路径。
  - 修正 `git clone` 地址为二改版仓库，并补充安装位置警告。

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
