// Profile 自查工具：注册一个 DSH tool，用户在对话里调用可查插件状态。
// 工具名：emperor_profile。调用后返回 JSON 状态报告。

/** 创建状态快照。 */
export function createStatusReport({ cfg, engine, recoverInstalled, wakeInstalled, autoContinueInstalled, scorer, identityStripped }) {
  return {
    plugin: "zfx-emperor",
    version: "0.2.0-mod.4",
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

  // DSH 0.2.0-rc.2 起，dsh-tools 的 register() 强制要求定义里带
  // output { schema, render, presentationMeta? }，缺了会抛：
  //   tool "emperor_profile" must declare output { schema, render, presentationMeta? }
  // 该异常发生在插件 apply 阶段，会让整个插件激活失败（1 entry did not activate）。
  // 结果文本仍是 JSON 字符串，因此 output.schema 声明为 string 即可。
  const dispose = runtime.register({
    name: "emperor_profile",
    description: "查看ZFX Emperor插件的当前状态：注入段、审批门、续命计数、评分统计。",
    parameters: { type: "object", properties: {} },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [
        { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
      ],
    },
    async execute() {
      const report = typeof getReport === "function" ? getReport() : {};
      return JSON.stringify(report, null, 2);
    },
  });

  return {
    dispose() {
      try { dispose?.(); } catch { /* */ }
    },
  };
}
