/** P22：悬停别家亮词 / 摊开的暗词——悬停区收集、浮层内容、释义缓存 */

import { Group } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope, State } from "../api";
import { fakeAssetLoader } from "./fake-assets";
import { DefinitionCache, hoverCard } from "./hover-card";
import { ObjectView } from "./object-view";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}
beforeEach(() => vi.stubGlobal("window", { localStorage: fakeStorage() }));

const base = (): State => structuredClone(fixtureGames()[0].steps[2].state);
const w = (word: string) => ({ tiles: word, word });

/** 座位 1 亮了 CAT、DOG；座位 2 胡了、摊开 SUN BED；座位 3 荒牌摊开 AT、剩下背面；自己亮了 BE */
function scene(): State {
  const s = base();
  s.me.melds = [w("be")];
  const o = (seat: number) => s.others.find((x) => x.seat === seat)!;
  o(1).melds = [w("cat"), w("dog")];
  o(1).handCount = 7;
  o(2).won = true;
  o(2).winOrder = 0;
  o(2).concealed = [w("sun"), w("bed")];
  o(2).handCount = 6;
  o(3).concealed = [w("at")];
  o(3).handCount = 5; // 2 张摊开 + 3 张背面
  return s;
}

describe("悬停区收集", () => {
  const env = (st: State): Envelope => ({ matchId: "m-hover", events: [], state: st, pending: null, result: null, matchFinished: false });
  const view = () => {
    const v = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    v.apply(env(scene()));
    return v;
  };

  it("别家亮词区的牌进，kind = meld，座位标对", () => {
    const t = view().hoverTargets.filter((x) => x.kind === "meld");
    expect(t.filter((x) => x.seat === 1)).toHaveLength(6); // CAT + DOG
    expect(t.every((x) => x.seat !== 0)).toBe(true);
  });

  it("别家摊开的正面牌进，kind = concealed；背面牌不进", () => {
    const t = view().hoverTargets.filter((x) => x.kind === "concealed");
    expect(t.filter((x) => x.seat === 2)).toHaveLength(6); // SUN BED 全摊开
    expect(t.filter((x) => x.seat === 3)).toHaveLength(2); // 只有 AT 两张，另外 3 张背面不进
    expect(t.filter((x) => x.seat === 1)).toHaveLength(0); // 没胡没荒，全是背面
  });

  it("自己的牌（散牌区、亮词区）一张都不进", () => {
    expect(view().hoverTargets.some((x) => x.seat === 0)).toBe(false);
  });
});

describe("浮层内容", () => {
  it("亮词：标题是名字，小标题「亮词 N 个」，按亮出顺序", () => {
    expect(hoverCard(scene(), { seat: 1, kind: "meld" })).toEqual({ title: "Jean", subtitle: "亮词 2 个", words: ["cat", "dog"] });
  });
  it("胡牌摊开：标题带「第 N 胡」，小标题「胡牌时的暗词」", () => {
    expect(hoverCard(scene(), { seat: 2, kind: "concealed" })).toEqual({
      title: "Loyce · 第 1 胡",
      subtitle: "胡牌时的暗词",
      words: ["sun", "bed"],
    });
  });
  it("荒牌摊开（没胡但 concealed 非空）：小标题「摊开的暗词」", () => {
    expect(hoverCard(scene(), { seat: 3, kind: "concealed" })).toEqual({ title: "Loura", subtitle: "摊开的暗词", words: ["at"] });
  });
  it("自己不出浮层", () => {
    expect(hoverCard(scene(), { seat: 0, kind: "meld" })).toBeNull();
  });
});

describe("释义缓存", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const deferred = () => {
    const calls: { word: string; resolve: (v: { found: boolean; definition?: string }) => void; reject: (e: unknown) => void }[] = [];
    const define = (word: string) =>
      new Promise<{ found: boolean; definition?: string }>((resolve, reject) => calls.push({ word, resolve, reject }));
    return { calls, define };
  };

  it("同一个词只请求一次；查到后缓存", async () => {
    const d = deferred();
    const c = new DefinitionCache(d.define, () => {});
    c.request("cat");
    c.request("cat"); // 在途，去重
    expect(d.calls).toHaveLength(1);
    expect(c.get("cat")).toEqual({ status: "loading" });
    d.calls[0].resolve({ found: true, definition: "n. 猫" });
    await flush();
    expect(c.get("cat")).toEqual({ status: "found", text: "n. 猫" });
    c.request("cat"); // 已缓存
    expect(d.calls).toHaveLength(1);
  });

  it("查不到：missing，也缓存", async () => {
    const d = deferred();
    const c = new DefinitionCache(d.define, () => {});
    c.request("zzz");
    d.calls[0].resolve({ found: false });
    await flush();
    expect(c.get("zzz")).toEqual({ status: "missing" });
    c.request("zzz");
    expect(d.calls).toHaveLength(1);
  });

  it("失败不缓存：显示没取到，下次悬停再请求", async () => {
    const d = deferred();
    let updates = 0;
    const c = new DefinitionCache(d.define, () => updates++);
    c.request("dog");
    d.calls[0].reject(new Error("断网"));
    await flush();
    expect(c.get("dog")).toEqual({ status: "error" });
    expect(updates).toBe(1);
    c.request("dog");
    expect(d.calls).toHaveLength(2);
  });
});
