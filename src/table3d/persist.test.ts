/**
 * 存档读写（T1.4 方案 §6）。
 *
 * vitest 跑在 node 环境，没有 window/localStorage——这里自己造一个最小实现，
 * 顺便证明 `persist.ts` 在拿不到 localStorage 时会安静退化而不是崩。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOOSE_SLOTS } from "./layout";
import { clear, load, save } from "./persist";
import type { LooseSlots } from "./loose-reconcile";

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

const slots = (): LooseSlots => {
  const s: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
  s[0] = { tileId: 1, tile: "c" };
  s[5] = { tileId: 2, tile: "1", wildLetter: "o" };
  return s;
};

let store: Storage;

beforeEach(() => {
  store = fakeStorage();
  vi.stubGlobal("window", { localStorage: store });
});
afterEach(() => vi.unstubAllGlobals());

describe("存档", () => {
  it("存进去读得回来，白搭声明也在", () => {
    save("m1", { loose: slots(), display: { lowercase: true }, nextTileId: 3 });
    const got = load("m1")!;
    expect(got.loose[0]).toEqual({ tileId: 1, tile: "c" });
    expect(got.loose[5]!.wildLetter).toBe("o");
    expect(got.display.lowercase).toBe(true);
    expect(got.nextTileId).toBe(3);
  });

  it("键里带 matchId——开新局不会误读旧记录", () => {
    save("m1", { loose: slots(), display: { lowercase: false }, nextTileId: 3 });
    expect(load("m2")).toBeNull();
  });

  it("版本不认识就丢弃重建，不能崩", () => {
    save("m1", { loose: slots(), display: { lowercase: false }, nextTileId: 3 });
    const raw = JSON.parse(store.getItem("emj3d.loose.m1")!);
    store.setItem("emj3d.loose.m1", JSON.stringify({ ...raw, version: 99 }));
    expect(load("m1")).toBeNull();
  });

  it("长度对不上（布局常量改过）也按版本不认处理", () => {
    save("m1", { loose: slots(), display: { lowercase: false }, nextTileId: 3 });
    const raw = JSON.parse(store.getItem("emj3d.loose.m1")!);
    store.setItem("emj3d.loose.m1", JSON.stringify({ ...raw, loose: raw.loose.slice(0, 5) }));
    expect(load("m1")).toBeNull();
  });

  it("坏 JSON 不能把牌局带崩", () => {
    store.setItem("emj3d.loose.m1", "{不是 json");
    expect(load("m1")).toBeNull();
  });

  it("结算 / 服务端 404 之后确实清掉了", () => {
    save("m1", { loose: slots(), display: { lowercase: false }, nextTileId: 3 });
    expect(load("m1")).not.toBeNull();
    clear("m1");
    expect(load("m1")).toBeNull();
    expect(store.getItem("emj3d.loose.m1")).toBeNull();
  });

  it("读取时顺手清掉很久没动过的记录", () => {
    save("old", { loose: slots(), display: { lowercase: false }, nextTileId: 3 });
    const raw = JSON.parse(store.getItem("emj3d.loose.old")!);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    store.setItem("emj3d.loose.old", JSON.stringify({ ...raw, updatedAt: eightDaysAgo }));

    save("fresh", { loose: slots(), display: { lowercase: false }, nextTileId: 3 });
    load("fresh"); // 触发 sweep

    expect(store.getItem("emj3d.loose.old")).toBeNull();
    expect(store.getItem("emj3d.loose.fresh")).not.toBeNull();
  });

  it("拿不到 localStorage 时安静退化，不抛", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("隐私模式");
      },
    });
    expect(() => save("m1", { loose: slots(), display: { lowercase: false }, nextTileId: 1 })).not.toThrow();
    expect(load("m1")).toBeNull();
    expect(() => clear("m1")).not.toThrow();
  });
});
