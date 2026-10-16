// ZFX Emperor — 浏览器半边（Web UI 状态徽章）
//
// DSH 的 client 插件不是 ES module：加载器把它当经典脚本执行，要求调用
// window.__ModuleLoader__.load({ id, factory })。写成 `export ...` 会直接抛
// SyntaxError: Unexpected token 'export'，宿主报 "1 entry did not activate"。
// 参考实现：dsh-codex-effort-slider/lib/client.js。
window.__ModuleLoader__.load({
  id: "zfx-emperor",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    function mount(root, options) {
      var status = options && options.status;

      // 徽章容器
      var badge = document.createElement("div");
      badge.id = "zfx-emperor-badge";
      badge.style.cssText = [
        "position:fixed",
        "bottom:12px",
        "right:12px",
        "z-index:9999",
        "display:flex",
        "align-items:center",
        "gap:6px",
        "padding:4px 10px",
        "border-radius:4px",
        "background:#101010",
        "color:#f59e0b",
        "font-size:12px",
        "font-family:monospace",
        "box-shadow:0 2px 8px rgba(0,0,0,0.3)",
        "cursor:default",
        "user-select:none",
      ].join(";");

      // 棱形图标
      var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("width", "14");
      icon.setAttribute("height", "14");
      icon.setAttribute("viewBox", "0 0 200 200");
      icon.innerHTML =
        '<rect x="60" y="60" width="80" height="80" transform="rotate(45 100 100)" fill="none" stroke="#f59e0b" stroke-width="20"/>';
      badge.appendChild(icon);

      var label = document.createElement("span");
      label.textContent = "正方形在线";
      badge.appendChild(label);

      if (status && status.scorer) {
        var stats = document.createElement("span");
        stats.style.color = "#888";
        stats.textContent = "avg " + (status.scorer.avg != null ? status.scorer.avg : "?");
        badge.appendChild(stats);
      }

      root.appendChild(badge);

      return {
        update: function (newStatus) {
          if (newStatus && newStatus.scorer) {
            var last = badge.querySelector("span:last-child");
            if (last) last.textContent = "avg " + (newStatus.scorer.avg != null ? newStatus.scorer.avg : "?");
          }
        },
        unmount: function () {
          badge.remove();
        },
      };
    }

    exports.name = "zfx-emperor-client";
    exports.mount = mount;
    exports.apply = function () {
      // 无 UI 插槽依赖；卸载时清掉徽章。
      return {
        dispose: function () {
          var el = document.getElementById("zfx-emperor-badge");
          if (el && el.parentNode) el.parentNode.removeChild(el);
        },
      };
    };
    return module.exports;
  },
});
