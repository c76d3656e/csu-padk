/* ============================================================
 * 中南大学 智慧学工 · 平安打卡  浏览器控制台一键打卡
 * ------------------------------------------------------------
 * 用法：
 *   1. 浏览器打开 https://zhxg.csu.edu.cn/znzhxgpt_h5/
 *   2. F12 -> Ctrl+Shift+M 开设备模拟 -> 刷新 -> CAS 登录
 *   3. 登录后回到首页，F12 Console 粘贴本文件全部内容，回车
 *
 * 自定义坐标（绕过地域）：
 *   先执行 PADK.setLocation(经度, 纬度, "地址文本")
 *   再执行 PADK.run()
 * ============================================================ */
(() => {
  "use strict";

  const ORIGIN = location.origin;
  const API = {
    // 对外入口：/znzhxgpt/<模块>/<接口>  （nginx 会剥掉 /znzhxgpt 前缀转发到网关）
    base: ORIGIN + "/znzhxgpt/qxj",
    check: "/qxj-padkglxx/jcqqwzsjsfndk", // 围栏校验
    punch: "/qxj-padkglxx/xspadk",        // 提交打卡
    shifts: "/qxj-padkglxx/queryKqDkbc",  // 打卡班次
  };

  // ---------- localStorage 兜底读取（uni-app 各版本 key 处理不同）----------
  const raw = (k) => {
    try {
      let v = localStorage.getItem(k);
      if (v == null) {
        // uni-app 有时会加前缀
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key === k || key.endsWith(":" + k) || key.endsWith("_" + k))) {
            v = localStorage.getItem(key);
            break;
          }
        }
      }
      if (v == null) return null;
      const s = String(v).trim();
      if (s.startsWith("{") || s.startsWith("[") || s.startsWith('"')) {
        try { return JSON.parse(s); } catch (_) {}
      }
      return s;
    } catch (e) { return null; }
  };

  const TOKEN = raw("token") || "";
  const AGENT = raw("agent") || {};
  const MENU = raw("currentMenuId") || "";

  const headers = () => ({
    "Content-Type": "application/json; charset=utf-8",
    deviceType: "4",
    Authorization: TOKEN,
    token: TOKEN,
    MenuId: (MENU && MENU.data) ? MENU.data : "",
    AppCode: "znzhxgpt",
    agentId: (AGENT && AGENT.id) ? AGENT.id : "",
  });

  async function call(path, paramsData, extra) {
    const url = new URL(API.base + path, ORIGIN).href;
    const body = { paramsData: Object.assign({}, paramsData, extra || {}) };
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: headers(),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, url, body, json, text };
  }

  // ---------- 状态 ----------
  const state = {
    jd: null,   // 经度
    wd: null,   // 纬度
    dz: "",     // 地址文本
    dkbc: null, // 打卡班次
    dklb: "0",  // 打卡类别：0 校内住宿 / 4 校外租房
    wcdk: false // 是否走"外出打卡"分支
  };

  const PADK = {
    state,
    token: TOKEN,

    /** 手动指定坐标（绕过地域限制的核心） */
    setLocation(jd, wd, dz) {
      state.jd = Number(jd);
      state.wd = Number(wd);
      if (dz) state.dz = dz;
      console.log("%c[坐标已锁定]", "color:#19be6b;font-weight:700", state.jd, state.wd, state.dz);
      return this;
    },

    /** 设置打卡班次 */
    setShift(dkbc) { state.dkbc = dkbc; return this; },

    /** 从浏览器真实定位（仅用于首次校准，不在学校别用） */
    async useBrowserLocation() {
      const pos = await new Promise((ok, no) =>
        navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 10000 })
      );
      state.jd = pos.coords.longitude;
      state.wd = pos.coords.latitude;
      console.log("%c[浏览器定位]", "color:#f90", state.jd, state.wd);
      return this;
    },

    /** 1) 围栏预检 —— 看服务端认为你能不能在当前位置打卡 */
    async verify() {
      if (state.jd == null || state.wd == null) throw new Error("未设置坐标，先 PADK.setLocation(经度,纬度)");
      const r = await call(API.check, { jd: state.jd, wd: state.wd, dklb: state.dklb });
      console.log("%c[围栏校验]", "color:#2278fd;font-weight:700", r.status, r.json || r.text);
      return r;
    },

    /** 2) 提交打卡 */
    async punch(extra) {
      if (state.jd == null || state.wd == null) throw new Error("未设置坐标，先 PADK.setLocation(经度,纬度)");
      const params = {
        jd: state.jd,
        wd: state.wd,
        dkbc: state.dkbc,
        dkdz: state.dz || "",
      };
      const r = await call(API.punch, params, extra || (state.wcdk ? { sfwcdk: 1 } : null));
      console.log("%c[提交打卡]", "color:#19be6b;font-weight:700", r.status, r.json || r.text);
      return r;
    },

    /** 一键：预检 -> 提交 */
    async run(extra) {
      console.log("%c=== 平安打卡 开始 ===", "color:#7f5af0;font-weight:700;font-size:14px");
      if (!TOKEN) console.warn("!! 未取到 token，请先登录再执行。当前 token 为空。");
      try {
        const v = await this.verify();
        const can = v.json && v.json.data && typeof v.json.data === "object"
          ? v.json.data.canDk
          : v.json && v.json.data;
        if (can === false) {
          console.warn("%c!! 服务端判定不在范围内，仍尝试提交（用于验证服务端是否二次校验）", "color:#fa3534");
          console.warn("   提示：", v.json && v.json.data && v.json.data.msg,
            "| 偏差", v.json && v.json.data && v.json.data.pcMi,
            "米 / 范围", v.json && v.json.data && v.json.data.fwMi, "米");
        }
        const r = await this.punch(extra);
        if (r.json && String(r.json.code) === "200") {
          console.log("%c>>> 打卡成功", "color:#19be6b;font-weight:700;font-size:15px");
        } else {
          console.log("%c>>> 打卡返回异常，见上方 JSON", "color:#f90;font-weight:700");
        }
        return r;
      } catch (e) {
        console.error("[PADK] 失败:", e);
      }
    },

    /** 查询打卡班次（不知道 dkbc 时用） */
    async shifts(payload) {
      const r = await call(API.shifts, payload || {});
      console.log("%c[班次查询]", "color:#2278fd;font-weight:700", r.status, r.json || r.text);
      return r;
    },

    /** 环境自检 */
    info() {
      console.table({
        origin: ORIGIN,
        token: TOKEN ? TOKEN.slice(0, 24) + "..." : "(空)",
        agentId: (AGENT && AGENT.id) || "(空)",
        menuId: (MENU && MENU.data) || "(空)",
        ua_isMobile: /iphone|ipod|android|harmony|windows phone|mobile/i.test(navigator.userAgent.toLowerCase()),
        jd: state.jd, wd: state.wd, dkbc: state.dkbc,
      });
      return this;
    },
  };

  window.PADK = PADK;
  console.log(
    "%c平安打卡控制台已注入",
    "color:#7f5af0;font-weight:700;font-size:15px",
    "\n  PADK.info()                          环境自检" +
    "\n  PADK.useBrowserLocation()            读浏览器定位" +
    "\n  PADK.setLocation(经度, 纬度, '地址')   锁定坐标（绕过地域）" +
    "\n  PADK.verify()                        围栏预检" +
    "\n  PADK.run()                           一键预检+打卡" +
    "\n  PADK.run({sfwcdk:1})                 走外出打卡分支" +
    "\n  PADK.shifts()                        查打卡班次"
  );
})();
