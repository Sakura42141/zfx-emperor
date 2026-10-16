// 身份剥离：把官方 "You are a coding agent powered by {{model}} model." 前缀置空。
// 学 dsh-purge 的 SYSTEM_PROMPT_PERSONA / WEB_PRESET_IDENTITY_STRIP 补丁，
// 但只做最小集：personaPrefix / prefix 两处，幂等，带标记。

import { createRequire } from "node:module";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const MARK = "// [zfx-emperor] identity stripped";

// 官方身份前缀的多种形态（跨版本宽容）
const IDENTITY_PATTERNS = [
  "You are a coding agent powered by the {{model}} model.",
  "You are a coding agent powered by the {{ model }} model.",
];

// 候选目标文件：preset 里的 personaPrefix / prefix 字段
function resolvePresetFiles() {
  const req = createRequire(import.meta.url);
  const candidates = [];
  try {
    const dshRoot = dirname(req.resolve("@deepseek-ai/dsh/package.json"));
    const presetsDir = join(dshRoot, ".agent-presets");
    for (const sub of ["unrestricted", "standard"]) {
      candidates.push(join(presetsDir, sub, "agent.cordis.yml"));
    }
  } catch { /* not in dep tree */ }
  const home = process.env.DSH_HOME || process.env.DSH_BASE;
  if (home) {
    candidates.push(join(home, "profiles", "web", ".agent-presets", "unrestricted", "agent.cordis.yml"));
  }
  return candidates.filter((p) => existsSync(p));
}

/** 检测身份前缀是否还在（未剥）。 */
export function detectIdentityStrip() {
  const files = resolvePresetFiles();
  const results = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const hasIdentity = IDENTITY_PATTERNS.some((p) => src.includes(p));
    const hasMark = src.includes(MARK);
    results.push({ file, hasIdentity, hasMark, stripped: hasMark || !hasIdentity });
  }
  return results;
}

/** 对所有找到的 preset 文件执行身份剥离。幂等：已剥则跳过。 */
export function stripIdentity() {
  const files = resolvePresetFiles();
  const applied = [];
  for (const file of files) {
    let src = readFileSync(file, "utf8");
    if (src.includes(MARK)) continue; // 已剥
    let changed = false;
    for (const pattern of IDENTITY_PATTERNS) {
      if (src.includes(pattern)) {
        const bak = `${file}.zfx-identity.bak`;
        if (!existsSync(bak)) copyFileSync(file, bak);
        src = src.replaceAll(pattern, "");
        changed = true;
      }
    }
    if (changed) {
      // 在文件末尾加标记
      if (!src.endsWith("\n")) src += "\n";
      src += `${MARK}\n`;
      writeFileSync(file, src, "utf8");
      applied.push(file);
    }
  }
  return { applied, scanned: files };
}

/** 从 .bak 还原身份剥离。 */
export function restoreIdentity() {
  const files = resolvePresetFiles();
  const restored = [];
  for (const file of files) {
    const bak = `${file}.zfx-identity.bak`;
    if (existsSync(bak)) {
      copyFileSync(bak, file);
      restored.push(file);
    }
  }
  return { restored };
}
