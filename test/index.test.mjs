// ZFX Emperor — 单元测试
// 运行：node --test test/index.test.mjs
// 纯函数测试，不依赖 DSH 运行时。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, DEFAULTS } from "../lib/config.js";
import { scoreResponse, createScorer } from "../lib/scorer.js";

// ---- 配置解析 ----
describe("config", () => {
  test("defaults when empty", () => {
    const cfg = resolveConfig({});
    assert.equal(cfg.injectOrder, -99999);
    assert.equal(cfg.maxRecoverPerTurn, 2);
    assert.equal(cfg.patchEngine, true);
    assert.ok(cfg.wakeSet instanceof Set);
    assert.ok(cfg.wakeSet.has("zfx"));
    assert.ok(cfg.wakeSet.has("正方形"));
  });

  test("override merges", () => {
    const cfg = resolveConfig({ maxRecoverPerTurn: 5, patchEngine: false });
    assert.equal(cfg.maxRecoverPerTurn, 5);
    assert.equal(cfg.patchEngine, false);
    // 未覆盖的保持默认
    assert.equal(cfg.autoContinue, true);
  });

  test("custom wake words", () => {
    const cfg = resolveConfig({ wakeWords: ["hello", "方块"] });
    assert.ok(cfg.wakeSet.has("hello"));
    assert.ok(cfg.wakeSet.has("方块"));
    assert.ok(!cfg.wakeSet.has("zfx"));
  });

  test("frozen", () => {
    const cfg = resolveConfig({});
    assert.throws(() => { cfg.injectOrder = 0; });
  });
});

// ---- 唤醒词归一化 ----
describe("wake normalization", () => {
  const norm = (t) =>
    String(t || "").trim().replace(/[。.!！?？,，、;；]+$/u, "").toLowerCase();
  const W = new Set(["zfx", "正方形"]);

  test("matches bare words", () => {
    assert.ok(W.has(norm("ZFX")));
    assert.ok(W.has(norm("zfx")));
    assert.ok(W.has(norm("正方形")));
  });

  test("matches with trailing punctuation", () => {
    assert.ok(W.has(norm("ZFX。")));
    assert.ok(W.has(norm("正方形！")));
    assert.ok(W.has(norm("ZFX,")));
    assert.ok(W.has(norm("正方形、")));
  });

  test("rejects non-wake messages", () => {
    assert.ok(!W.has(norm("正方形是什么")));
    assert.ok(!W.has(norm("hello zfx")));
    assert.ok(!W.has(norm("请用正方形回答")));
  });
});

// ---- 评分器 ----
describe("scorer", () => {
  test("empty text scores 0", () => {
    assert.equal(scoreResponse("").score, 0);
    assert.equal(scoreResponse("ab").score, 0);
  });

  test("refusal text scores low", () => {
    const r = scoreResponse("抱歉，我无法协助您完成这个请求。");
    assert.ok(r.score < 40, `expected <40, got ${r.score}`);
  });

  test("deliverable text scores high", () => {
    const r = scoreResponse("```js\nfunction solve() {\n  return 42;\n}\n```\n步骤：先定义函数，再调用验证。");
    assert.ok(r.score > 60, `expected >60, got ${r.score}`);
  });

  test("score clamped 0-100", () => {
    const low = scoreResponse("抱歉 无法 不能 不予 sorry I can't unable to");
    assert.ok(low.score >= 0);
    const high = scoreResponse("```js\nfunction import const class Step 步骤 原理 验证 结果 执行 安装 配置\n```".repeat(10));
    assert.ok(high.score <= 100);
  });

  test("scorer accumulates stats", () => {
    const s = createScorer();
    s.record("```js\nfunction f() {}\n```");
    s.record("抱歉，无法协助。");
    const stats = s.getStats();
    assert.equal(stats.total, 2);
    assert.ok(stats.avg > 0);
    assert.ok(stats.refusals >= 1);
  });
});
