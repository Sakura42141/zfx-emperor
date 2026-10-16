# 二改说明

本仓库是 **ZFX Emperor** 的二改（fork / derivative work）。

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/ZFXing-lite/zfx-emperor |
| 上游 commit | `8237621a5c454ae4893b34513ede3745bb019431`（main） |
| 原作者 | **正方形**（ZFXing-lite） |
| 上游许可 | MIT |
| 本版版本号 | `0.2.0-mod.1` |
| 二改目标 | 让插件在 **DSH 0.2.0-rc.2** 上能装上、能加载、能生效 |

---

## 为什么要二改

上游 `0.2.0` 在本机 DSH 上**装不上**。安装器在装完后校验，直接拒绝并回滚：

```
dsh: installation rejected: Cannot validate installed package zfx-emperor:
Error: dsh: overlay ...\node_modules\zfx-emperor\cordis.patch.yml
must be a top-level YAML array of loader patch entries
dsh: restored package.json, pnpm-lock.yaml, and node_modules.
```

顺着这条线索排查，发现上游在该 DSH 版本上有 **4 处硬伤**，每一处都会单独导致插件无法工作。全部修掉才能正常使用。

---

## 改动清单

### 1. `cordis.patch.yml` —— 格式错误（致命，直接导致装不上）

**症状**：`dsh plugin install` 装完即被拒绝并回滚，`node_modules` 里什么都不剩。

**原因**：该文件是 bundle 的 **loader patch 层**，DSH 要求顶层必须是 YAML **数组**，每个元素是一条 patch entry。
上游写成了 **YAML 映射**（顶层 `zfx-emperor:` 键），那是 profile 配置树方言，不是 patch 层方言。
`dsh-app-boot` 的 `parsePatchList()` 判定 `Array.isArray(parsed) === false` 后直接抛错：

```js
// @deepseek-ai/dsh-app-boot/lib/index.js
if (!Array.isArray(parsed))
  throw new Error(`${binName}: ${label} ${file} must be a top-level YAML array of loader patch entries`);
```

**改法**：改为标准写法 —— 用 `- insert:` 插入插件行，原配置项全部搬到该行的 `config` 下：

```yaml
- insert:
    - id: zfx-emperor
      name: 'zfx-emperor'
      config:
        injectOrder: -99999
        wakeWords: [zfx, 正方形]
        # …
```

`id` 与包名保持一致（DSH 预检按它比对 entryIds），插件行那一行不写行尾注释。

---

### 2. `lib/profile-tool.js` —— 服务名写错（插件激活失败）

**症状**：插件行进了配置树，但启动时 `emperor_profile` 工具注册不了，插件激活失败。

**原因**：宿主 `@deepseek-ai/dsh-tools` 用 `super(ctx, "tools")` 注册服务 —— 是**复数** `tools`，注册方法是 `ctx.tools.register(definition)`。
上游写的是 `ctx.tool`，取到 `undefined`；而取未在 `inject` 里声明的属性会让宿主抛
`cannot get property X without inject`。

**改法**：

```js
// 前
if (!ctx?.tool || typeof ctx.tool !== "function") return null;
const dispose = ctx.tool({ ... });

// 后
const runtime = ctx?.tools;
if (!runtime || typeof runtime.register !== "function") return null;
const dispose = runtime.register({ ... });
```

---

### 3. `client.js` —— 模块制式错误（Web 半边不加载）

**症状**：宿主报 `1 entry did not activate`；右下角「正方形在线」徽章不出现。

**原因**：DSH 的 client 插件**不是 ES module** —— 加载器把它当**经典脚本**执行，要求调用
`window.__ModuleLoader__.load({ id, factory })`。上游写成了 `export const name = …` / `export function mount(…)`，
浏览器直接抛 `SyntaxError: Unexpected token 'export'`。

**改法**：整文件重写为 `__ModuleLoader__.load()` 包装，内部改用 ES5 语法（`var` + `function`），
并补上 `exports.apply` 的卸载清理。参考实现：`dsh-codex-effort-slider/lib/client.js`。

---

### 4. `install.ps1` —— profile 写死（装错位置）

**症状**：默认装到 `web` profile，桌面端用户装完不生效。

**原因**：上游把 `-ProfileName` 默认值写死为 `"web"`。

**改法**：默认改为自动探测 —— 唯一带 `package.json` 的 profile 直接用；多个时优先 `desktop`、其次 `web`；
都不匹配则列出候选并要求显式传 `-ProfileName`。

---

### 5. `index.js` —— 仅补注释（无行为变更）

在 `export const inject = [...]` 上方补了 3 行注释，说明服务名必须是宿主真实注册的复数值，
以及取未声明服务会让宿主抛错的机制。便于后续维护者不再踩同一个坑。

---

## 未改动的部分

以下文件与上游**逐字节一致**，本次二改未触碰：

```
.gitignore  docs/logo.svg  docs/logo-dark.svg
lib/config.js  lib/continue-retry.js  lib/identity-strip.js
lib/patcher.js  lib/scorer.js
prompts/square.md          ← persona 正文，未改动
README.en.md  uninstall.ps1  LICENSE  test/index.test.mjs
package.json               ← 仅版本号与元数据字段
```

**`prompts/square.md`（破甲词本体）与原作者的引擎补丁逻辑（`lib/patcher.js`）完全保持原样** —— 本二改只修适配问题，不改设计。

---

## 验证记录

改动后在本机 DSH `0.2.0-rc.2` + Node `v24.21.0` 上验证：

```
loadOverlayPatches   → OK: parsed as array, entries = 1
loadProfileDirectory → layers: 19, skippedBundles: [], zfx-emperor layer: LOADED
composeEntries       → 217 rows，zfx-emperor 行含完整 config
import(index.js)     → name: zfx-emperor, inject: ["systemPrompt","tools"], apply: function
node --check         → index.js / client.js / lib/*.js 全部通过
```

安装方式：`link:` 到 `$DSH_HOME/plugins/zfx-emperor`，`pnpm install` 退出码 0。

---

## 许可

沿用上游 **MIT**。原始版权声明完整保留，二改部分同样以 MIT 发布。
详见 [LICENSE](LICENSE)。
