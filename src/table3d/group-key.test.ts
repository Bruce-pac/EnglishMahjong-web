/** T4.2：暗词配对认 groupKey，不再永远挑最左边的同字母牌 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Word } from "../api";
import { groupKeyOf, markGroup, rebuildLoose, reconcileLoose, type LooseSlots } from "./loose-reconcile";
import * as persist from "./persist";

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

const cat: Word = { tiles: "act", word: "cat" };
/** 散牌区里某个字母的第 k 张的 tileId */
const nth = (s: LooseSlots, tile: string, k: number) => s.filter((e) => e?.tile === tile)[k]!.tileId;
const grouped = (s: LooseSlots) => s.flatMap((e) => (e && e.groupId !== undefined ? [e.tileId] : [])).sort();

describe("groupKey", () => {
  it("有两张 A：拿右边那张组 CAT，标进暗词的就是右边那张；打牌、摸牌、存档往返后仍是", () => {
    let r = rebuildLoose({ hand: ["a", "c", "a", "t", "x"], groups: [] }, 1);
    const s0 = r.slots;
    const chosen = [nth(s0, "c", 0), nth(s0, "a", 1), nth(s0, "t", 0)];

    // 组暗词成功：先把 key 写到选中的那几张上，再拿服务端的 envelope 对账
    const marked = markGroup(s0, chosen, groupKeyOf("cat", "cat"));
    r = reconcileLoose({ hand: ["a", "c", "a", "t", "x"], groups: [cat] }, marked, r.nextTileId);
    expect(grouped(r.slots)).toEqual([...chosen].sort());

    // 打出 X、摸进 Z
    const x = nth(r.slots, "x", 0);
    r = reconcileLoose({ hand: ["a", "c", "a", "t"], groups: [cat] }, r.slots, r.nextTileId, [x]);
    r = reconcileLoose({ hand: ["a", "c", "a", "t", "z"], groups: [cat] }, r.slots, r.nextTileId);
    expect(grouped(r.slots)).toEqual([...chosen].sort());

    // 存档往返（刷新）
    persist.save("m1", { loose: r.slots, display: { lowercase: false }, nextTileId: r.nextTileId });
    const saved = persist.load("m1")!;
    r = reconcileLoose({ hand: ["a", "c", "a", "t", "z"], groups: [cat] }, saved.loose, saved.nextTileId);
    expect(grouped(r.slots)).toEqual([...chosen].sort());
  });

  it("对照：不写 key 时退回最左边那张 A", () => {
    const r0 = rebuildLoose({ hand: ["a", "c", "a", "t"], groups: [] }, 1);
    const r = reconcileLoose({ hand: ["a", "c", "a", "t"], groups: [cat] }, r0.slots, r0.nextTileId);
    expect(r.slots.find((e) => e?.tile === "a" && e.groupId !== undefined)!.tileId).toBe(nth(r0.slots, "a", 0));
  });

  it("两个暗词的 tiles|word 完全相同时不崩，六张牌分到两组", () => {
    const hand = ["c", "a", "t", "c", "a", "t"];
    const r0 = rebuildLoose({ hand, groups: [] }, 1);
    const key = groupKeyOf("cat", "cat");
    const marked = markGroup(r0.slots, r0.slots.flatMap((e) => (e ? [e.tileId] : [])), key);
    const r = reconcileLoose({ hand, groups: [cat, cat] }, marked, r0.nextTileId);
    const ids = r.slots.flatMap((e) => (e ? [e.groupId] : []));
    expect(ids.filter((g) => g === 0)).toHaveLength(3);
    expect(ids.filter((g) => g === 1)).toHaveLength(3);
  });

  it("暗词被服务端打散后，那几张牌的 key 被清掉", () => {
    const hand = ["c", "a", "t", "x"];
    let r = rebuildLoose({ hand, groups: [] }, 1);
    r = reconcileLoose(
      { hand, groups: [cat] },
      markGroup(r.slots, [nth(r.slots, "c", 0), nth(r.slots, "a", 0), nth(r.slots, "t", 0)], groupKeyOf("cat", "cat")),
      r.nextTileId,
    );
    expect(r.slots.filter((e) => e?.groupKey)).toHaveLength(3);
    r = reconcileLoose({ hand, groups: [] }, r.slots, r.nextTileId);
    expect(r.slots.filter((e) => e?.groupKey)).toHaveLength(0);
    expect(r.slots.filter((e) => e?.groupId !== undefined && e !== null)).toHaveLength(0);
  });

  it("没有 key 的暗词（2.5D 组的）不抢带 key 暗词的牌，哪怕那张在最左边", () => {
    // 散牌区 [a(带 ab 的 key)] [a] [t] [b]；第 0 组 AT 没有 key，第 1 组 AB 带 key，共用字母 a
    const hand = ["a", "a", "t", "b"];
    const r0 = rebuildLoose({ hand, groups: [] }, 1);
    const leftA = nth(r0.slots, "a", 0);
    const rightA = nth(r0.slots, "a", 1);
    const marked = markGroup(r0.slots, [leftA, nth(r0.slots, "b", 0)], groupKeyOf("ab", "ab"));
    const at: Word = { tiles: "at", word: "at" };
    const ab: Word = { tiles: "ab", word: "ab" };
    const r = reconcileLoose({ hand, groups: [at, ab] }, marked, r0.nextTileId);
    const groupOf = (id: number) => r.slots.find((e) => e?.tileId === id)!.groupId;
    expect(groupOf(leftA)).toBe(1);
    expect(groupOf(rightA)).toBe(0);
  });
});

