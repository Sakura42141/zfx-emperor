// 自动继续：模型因 max-tokens 截断时自动注入续命消息。
// 区别于拒绝恢复：那个是拒答续命，这个是截断续命。

import { randomUUID } from "node:crypto";

// turn/end 的 reason.kind 表示结束原因：
// "completed" = 正常完成，"length" / "max-tokens" = 截断，"stop" = 遇停止符
const TRUNCATE_REASONS = new Set(["length", "max-tokens", "max_tokens", "content-filter"]);

const CONTINUE_TEXT = "继续输出，从你刚才断掉的地方接上，不要重复已输出内容。";

function lastAssistantText(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
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

/** 安装自动继续监听。返回 { dispose } 或 null。 */
export function installAutoContinue(ctx, opts = {}) {
  if (typeof ctx?.on !== "function") return null;
  const maxPerTurn = opts.maxPerTurn ?? 3;
  const byTurn = new Map();

  const off = ctx.on(
    "agent/status",
    (payload) => {
      const agent = payload?.agent;
      if (!agent || payload?.status !== "idle") return;
      if (agent.status === "running") return;

      const events = sessionEventsOf(agent);
      const end = lastTurnEnd(events);
      if (!end) return;

      const reason = end.data?.reason?.kind || "";
      if (!TRUNCATE_REASONS.has(reason)) return;

      // 确认最后一条 assistant 消息有内容（确实是截断而非空回复）
      const text = lastAssistantText(events);
      if (!text || text.length < 20) return;

      const sid = agent.id || agent.session?.id || "";
      if (!sid || typeof agent.followup !== "function") return;

      const turn = end.data.turn || 0;
      let slot = byTurn.get(sid);
      if (!slot || slot.turn !== turn) {
        slot = { turn, count: 0 };
        byTurn.set(sid, slot);
      }
      if (slot.count >= maxPerTurn) return;

      try {
        agent.followup({
          id: `zfx-emperor-continue-${randomUUID()}`,
          role: "user",
          content: [{ type: "text", text: CONTINUE_TEXT }],
          source: { kind: "plugin", plugin: "zfx-emperor", form: "notice", summary: "auto-continue" },
        });
        slot.count += 1;
      } catch { /* */ }
    },
    { global: true },
  );

  return {
    dispose() {
      try { off?.(); } catch { /* */ }
      byTurn.clear();
    },
  };
}
