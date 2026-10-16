// Profile 自查工具：注册一个 DSH tool，用户在对话里调用可查插件状态。
// 工具名：emperor_profile。调用后返回 JSON 状态报告。

/** 创建状态快照。 */
export function createStatusReport({ cfg, engine, recoverInstalled, wakeInstalled, autoContinueInstalled, scorer, identityStripped }) {
  return {
    plugin: "zfx-emperor",
    version: "0.2.0",
    config: {
      injectOrder: cfg.injectOrder,
      wakeWords: cfg.wakeWords,
      maxRecoverPerTurn: cfg.maxRecoverPerTurn,
      patchEngine: cfg.patchEngine,
      stripIdentity: cfg.stripIdentity,
      autoContinue: cfg.autoContinue,
      scorer: cfg.scorer,
    },
    engine: engine || null,
    listeners: {
      refusalRecover: Boolean(recoverInstalled),
      wakeConfirm: Boolean(wakeInstalled),
      autoContinue: Boolean(autoContinueInstalled),
    },
    scorer: scorer ? scorer.getStats() : null,
    identityStripped: identityStripped || null,
    timestamp: new Date().toISOString(),
  };
}

/** 在 ctx 上注册 emperor_profile 工具。返回 dispose 或 null。 */
export function installProfileTool(ctx, getReport) {
  // 宿主服务名是复数 tools（@deepseek-ai/dsh-tools 里 super(ctx, "tools")），
  // 注册方法是 ctx.tools.register(definition)。写成 ctx.tool 会取到 undefined，
  // 而取未 inject 的属性会让宿主抛错、整个插件激活失败。
  const runtime = ctx?.tools;
  if (!runtime || typeof runtime.register !== "function") return null;

  const dispose = runtime.register({
    name: "emperor_profile",
    description: "查看ZFX Emperor插件的当前状态：注入段、审批门、续命计数、评分统计。",
    parameters: { type: "object", properties: {} },
    async execute() {
      const report = typeof getReport === "function" ? getReport() : {};
      return {
        content: [
          { type: "text", text: JSON.stringify(report, null, 2) },
        ],
      };
    },
  });

  return {
    dispose() {
      try { dispose?.(); } catch { /* */ }
    },
  };
}
