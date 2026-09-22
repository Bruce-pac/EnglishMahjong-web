/** T7.1：设置页的「牌桌样式」与开局分叉 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { MatchConfig } from "./api";

// App / Table3D 在模块加载时就会摸 localStorage 和地址栏（playerId、手牌大小写偏好…），
// 而 vitest 跑在 node 环境。先造出最小的 window/localStorage，再动态 import
let Setup: typeof import("./App").Setup;
let viewForStart: typeof import("./App").viewForStart;
let configForNewMatch: typeof import("./table3d/Table3D").configForNewMatch;

beforeAll(async () => {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
  const win = { localStorage: storage, location: { search: "", pathname: "/" } };
  Object.assign(globalThis, { localStorage: storage, window: win, location: win.location });
  const app = await import("./App");
  Setup = app.Setup;
  viewForStart = app.viewForStart;
  configForNewMatch = (await import("./table3d/Table3D")).configForNewMatch;
});

describe("设置页的牌桌样式", () => {
  const markup = () => renderToStaticMarkup(<Setup onStart={() => {}} onBack={() => {}} />);

  it("默认选中 3D", () => {
    const html = markup();
    // 选中的那一项带 seg-on
    expect(html).toMatch(/seg-btn seg-on[^>]*>3D 牌桌</);
    expect(html).toMatch(/seg-btn"[^>]*>经典</);
  });

  it("牌桌样式不进 MatchConfig：设置页里它是独立的一项", () => {
    // 开局请求里只有服务端认识的字段。这里验的是「样式没混进去」的前提：
    // onStart 的第二个参数才是样式（类型上就分开了），点击行为交给浏览器实测
    expect(viewForStart("3d")).toBe("table3d");
    expect(viewForStart("classic")).toBe("classic");
  });
});

describe("3D 页开新局用哪份配置", () => {
  it("设置页给了就用它", () => {
    const fromSetup = {
      tier: "cet4",
      difficulty: "hard",
      minWordLen: 3,
      minWinWordLen: 6,
      bloody: false,
      hints: true,
      maxGames: 2,
    } as MatchConfig;
    expect(configForNewMatch(fromSetup)).toBe(fromSetup);
  });

  it("没给就用 3D 自己的默认配置", () => {
    const c = configForNewMatch(null);
    expect(c).not.toBeNull();
    expect(c.hints).toBe(false); // 地址栏没有 ?hints=1
    expect(c.maxGames).toBeGreaterThan(0);
  });
});
