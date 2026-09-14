// ==UserScript==
// @name         CSU 平安打卡面板
// @name:zh-CN   CSU 平安打卡面板
// @namespace    https://github.com/c76d3656e/csu-padk
// @version      1.0.0
// @description  在智慧学工页面里浮出打卡面板：自动标注围栏、轮换落点、一键提交
// @author       c76d3656e
// @match        https://zhxg.csu.edu.cn/*
// @grant        none
// @run-at       document-idle
// @noframes
// @homepageURL  https://c76d3656e.github.io/csu-padk/
// @supportURL   https://github.com/c76d3656e/csu-padk/issues
// @license      MIT
// ==/UserScript==

/**
 * 只做一件事：把面板本体（inject.js）注入当前页面。
 *
 * 为什么不在脚本里直接写面板逻辑：
 *   @grant none 下本脚本与页面共享上下文，注入的 <script> 在页面里运行，
 *   于是它是**同源**的 —— 能读宿主的 localStorage 拿会话凭据、请求同源发出，
 *   不触发跨域预检。面板本体也就能和书签注入共用同一份代码。
 *
 * 官方页面没有 CSP（只有 X-Frame-Options: SAMEORIGIN，不影响脚本注入），
 * 所以从 github.io 加载脚本不会被拦。
 */
(function () {
  "use strict";

  var SCRIPT_ID = "csu-padk-inject";
  var INJECT_URL = "https://c76d3656e.github.io/csu-padk/inject.js";

  // 官方是单页应用，路由切换会重复触发，避免叠出多块面板
  if (document.getElementById(SCRIPT_ID)) return;

  var s = document.createElement("script");
  s.id = SCRIPT_ID;
  s.src = INJECT_URL + "?t=" + Date.now();
  s.onerror = function () {
    console.warn("[平安打卡] 注入包加载失败，检查网络或地址：", INJECT_URL);
  };
  (document.head || document.documentElement).appendChild(s);

  console.log(
    "%c[平安打卡] 油猴脚本已生效，面板正在挂载…",
    "color:#0a84ff;font-weight:700"
  );
})();
