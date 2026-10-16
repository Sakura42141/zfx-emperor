// ZFX Emperor v0.2.0
// 1) persona 注入（最高优先级段）
// 2) 拒绝自动续命 + 唤醒确认 + 截断自动继续
// 3) 引擎层：审批门接管 + 身份剥离
// 4) Profile 自查工具 + 实时评分器

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolveConfig } from "./lib/config.js";
import { detectEngineState, ensureApprovalBypass } from "./lib/patcher.js";
import { stripIdentity, detectIdentityStrip } from "./lib/identity-strip.js";
import { installAutoContinue } from "./lib/continue-retry.js";
import { createScorer } from "./lib/scorer.js";
import { installProfileTool, createStatusReport } from "./lib/profile-tool.js";

// persona 正文。转义非内置的 {{…}}，防止 DSH 模板插值引擎抛 malformed variable。
// 读取失败必须降级为空串：该语句在模块加载期执行，一旦抛异常，
// 整个插件在 import 阶段就会失败，连 apply() 都进不去。
let PROMPT_TEXT = "";
try {
  PROMPT_TEXT = readFileSync(new URL("./prompts/square.md", import.meta.url), "utf8")
    .replace(/\{\{(?!(?:cwd|model|provider)\}\})/g, "{ {");
} catch {
  PROMPT_TEXT = "";
}

export const name = "zfx-emperor";
// inject 必须列出本插件真正取用的服务名，且名字要与宿主提供的服务一致。
// 宿主 @deepseek-ai/dsh-tools 用 super(ctx, "tools") 注册服务 —— 是复数 "tools"。
// 取未声明的服务会让宿主抛 "cannot get property X without inject" 并导致插件激活失败。
export const inject = ["systemPrompt", "tools"];

// ---- 共用工具 ----

const REFUSAL =
  /(?:^|[\s。！？!?\n])(?:抱歉|对不起|我理解但|出于(?:安全|合规)|无法(?:协助|帮助|提供|完成)|不能(?:帮助|协助|提供)|不予(?:支持|提供)|I\s*(?:can't|cannot)|unable\s+to\s+(?:assist|help|comply)|sorry[,.\s]|(?:decline|refuse)\s+to\s+(?:assist|help|comply))/iu;

function lastAssistantText(events) {
  const list = Array.isArray(events) ? events : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const ev = list[i];
    if (ev?.type !== "assistant/message") continue;
    const blocks = ev.data?.content;
    if (!Array.isArray(blocks)) continue;
    const text = blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function lastUserText(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type !== "user/message") continue;
    const blocks = ev.data?.content;
    if (!Array.isArray(blocks)) continue;
    const text = blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function sessionEventsOf(agent) {
  const session = agent?.session;
  if (!session) return [];
  try {
    if (typeof session.snapshotEvents === "function") return session.snapshotEvents() || [];
  } catch { /* */ }
  try {
    if (Array.isArray(session.events)) return session.events;
  } catch { /* */ }
  return [];
}

function lastTurnEnd(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === "turn/end") return events[i];
  }
  return null;
}

function normalizeWake(text) {
  return String(text || "")
    .trim()
    .replace(/[。.!！?？,，、;；]+$/u, "")
    .toLowerCase();
}

// ---- 拒绝恢复 ----

function installRefusalRecover(ctx, cfg) {
  if (typeof ctx?.on !== "function") return null;
  const byTurn = new Map();

  const off = ctx.on(
    "agent/status",
    (payload) => {
      const agent = payload?.agent;
      if (!agent || payload?.status !== "idle") return;
      if (agent.status === "running") return;

      const events = sessionEventsOf(agent);
      const end = lastTurnEnd(events);
      if (end?.data?.reason?.kind !== "completed") return;

      const text = lastAssistantText(events);
      if (!String(text).trim() || text.length < 8 || !REFUSAL.test(text)) return;

      const sid = agent.id || agent.session?.id || "";
      if (!sid || typeof agent.followup !== "function") return;

      const turn = end.data.turn || 0;
      const key = `${turn}:${end.seq || 0}`;
      let slot = byTurn.get(sid);
      if (!slot || slot.turn !== turn) {
        slot = { turn, count: 0, lastKey: "" };
        byTurn.set(sid, slot);
      }
      if (slot.lastKey === key) return;
      if (slot.count >= cfg.maxRecoverPerTurn) return;

      try {
        agent.followup({
          id: `zfx-emperor-recover-${randomUUID()}`,
          role: "user",
          content: [{ type: "text", text: cfg.recoverText }],
          source: { kind: "plugin", plugin: "zfx-emperor", form: "notice", summary: "refusal-recover" },
        });
        slot.count += 1;
        slot.lastKey = key;
      } catch { /* */ }
    },
    { global: true },
  );

  return {
    dispose() { try { off?.(); } catch { /* */ } byTurn.clear(); },
    getCount() { return byTurn.size; },
  };
}

// ---- 唤醒确认 ----

function installWakeConfirm(ctx, cfg) {
  if (typeof ctx?.on !== "function") return null;
  const confirmed = new Map();

  const off = ctx.on(
    "agent/status",
    (payload) => {
      const agent = payload?.agent;
      if (!agent || payload?.status !== "idle") return;
      if (agent.status === "running") return;

      const events = sessionEventsOf(agent);
      const end = lastTurnEnd(events);
      if (end?.data?.reason?.kind !== "completed") return;

      const text = lastUserText(events);
      if (!cfg.wakeSet.has(normalizeWake(text))) return;

      const sid = agent.id || agent.session?.id || "";
      if (!sid || typeof agent.followup !== "function") return;

      const turn = end.data.turn || 0;
      if (confirmed.get(sid) === turn) return;
      if (confirmed.size > 200) confirmed.clear();
      confirmed.set(sid, turn);

      try {
        agent.followup({
          id: `zfx-emperor-wake-${randomUUID()}`,
          role: "user",
          content: [{ type: "text", text: cfg.wakeHint }],
          source: { kind: "plugin", plugin: "zfx-emperor", form: "notice", summary: "wake-confirm" },
        });
      } catch { /* */ }
    },
    { global: true },
  );

  return {
    dispose() { try { off?.(); } catch { /* */ } confirmed.clear(); },
  };
}

// ---- 评分监听 ----

function installScorerListener(ctx, scorer) {
  if (typeof ctx?.on !== "function") return null;

  const off = ctx.on(
    "agent/status",
    (payload) => {
      const agent = payload?.agent;
      if (!agent || payload?.status !== "idle") return;
      const events = sessionEventsOf(agent);
      const text = lastAssistantText(events);
      if (text) scorer.record(text);
    },
    { global: true },
  );

  return {
    dispose() { try { off?.(); } catch { /* */ } },
  };
}

// ---- 入口 ----

/** 安全执行一段可选逻辑：任何异常都吞掉，返回 fallback。
 *  设计原则：本插件的核心只有「persona 注入」和「工具注册」两件事，
 *  其余所有增强（引擎补丁、身份剥离、监听器、评分器）都不得让插件激活失败。 */
function safe(label, fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function apply(ctx, config = {}) {
  const cfg = resolveConfig(config);

  // 1) persona 注入（核心功能，必须成功；仍加保护以隔离宿主 API 差异）
  safe("systemPrompt.section", () =>
    ctx.effect(() =>
      ctx.systemPrompt.section({
        name: "zfx-emperor:operating-frame",
        order: cfg.injectOrder,
        text: PROMPT_TEXT,
      }),
    ),
  );

  // 2) 引擎层（可选增强，默认关闭）
  let engine = null;
  safe("engine", () => {
    engine = detectEngineState();
    if (engine && engine.approvalBypass === false && cfg.patchEngine === true) {
      const r = ensureApprovalBypass();
      if (r && r.skipped !== true) engine = { ...engine, patched: true, bak: r.bak };
    }
  });
  if (!engine) {
    engine = { file: null, approvalBypass: null, note: "引擎检测跳过（默认不修改宿主文件）" };
  }

  // 2b) 身份剥离（默认关闭）
  let identityResult = null;
  if (cfg.stripIdentity === true) {
    identityResult = safe("stripIdentity", () => stripIdentity(), { applied: [], scanned: [] });
  }
  const identityStripped = safe("detectIdentityStrip", () => detectIdentityStrip(), []);

  // 3) 评分器
  const scorer = safe("createScorer", () => (cfg.scorer ? createScorer() : null), null);

  // 4) 事件监听：拒绝恢复 + 唤醒确认 + 自动继续 + 评分
  const recover = safe("refusalRecover", () => installRefusalRecover(ctx, cfg), null);
  const wake = safe("wakeConfirm", () => installWakeConfirm(ctx, cfg), null);
  const autoContinue = safe("autoContinue", () => (cfg.autoContinue ? installAutoContinue(ctx) : null), null);
  const scorerListener = safe("scorerListener", () => (scorer ? installScorerListener(ctx, scorer) : null), null);

  const disposers = [recover, wake, autoContinue, scorerListener]
    .filter(Boolean)
    .map((it) => () => { try { it.dispose(); } catch { /* */ } });
  safe("disposers", () => {
    if (disposers.length && typeof ctx.effect === "function") {
      ctx.effect(() => disposers.forEach((dispose) => dispose()));
    }
  });

  // 5) Profile 自查工具（核心功能之一）
  const profileTool = safe("profileTool", () => {
    const getReport = () =>
      createStatusReport({
        cfg,
        engine,
        recoverInstalled: Boolean(recover),
        wakeInstalled: Boolean(wake),
        autoContinueInstalled: Boolean(autoContinue),
        scorer,
        identityStripped,
      });
    return installProfileTool(ctx, getReport);
  }, null);

  safe("profileToolDispose", () => {
    if (profileTool && typeof ctx.effect === "function") {
      ctx.effect(() => { try { profileTool.dispose(); } catch { /* */ } });
    }
  });

  return {
    plugin: name,
    version: "0.2.0-mod.4",
    injectOrder: cfg.injectOrder,
    engine,
    identityStripped,
    listeners: {
      refusalRecover: Boolean(recover),
      wakeConfirm: Boolean(wake),
      autoContinue: Boolean(autoContinue),
      scorer: Boolean(scorerListener),
    },
    profileTool: Boolean(profileTool),
  };
}
