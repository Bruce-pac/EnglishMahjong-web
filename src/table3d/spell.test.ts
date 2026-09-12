/** T4.1：框选结果 → 单词。顺序只来自 LooseSlots 的下标 */

import { describe, expect, it } from "vitest";
import { LOOSE_SLOTS } from "./layout";
import { declareWild, type LooseSlots } from "./loose-reconcile";
import { spellKey, spellSelection } from "./spell";

/** `.` 是空格；每个字符按出现顺序发 tileId（从 1 起） */
function row(pattern: string): LooseSlots {
  let id = 1;
  const out: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
  [...pattern.padEnd(LOOSE_SLOTS, ".")].forEach((c, i) => {
    if (c !== ".") out[i] = { tileId: id++, tile: c };
  });
  return out;
}
const idsOf = (s: LooseSlots, ...tiles: string[]) =>
  tiles.map((t) => s.find((e) => e?.tile === t)!.tileId);

describe("spellSelection", () => {
  it("传进来的 id 是倒序，结果仍按槽位下标从左到右", () => {
    const s = row("..cat");
    const [c, a, t] = idsOf(s, "c", "a", "t");
    expect(spellSelection(s, [t, a, c])).toEqual({ kind: "word", tiles: "cat", word: "cat" });
  });

  it("换了槽位顺序，读出来的词跟着变（ACT 不是 CAT）", () => {
    const s = row("..act");
    expect(spellSelection(s, idsOf(s, "c", "a", "t"))).toEqual({ kind: "word", tiles: "act", word: "act" });
  });

  it("选中的牌之间隔着空格和没选中的牌，都跳过", () => {
    const s = row("c.xa..t");
    const [c, a, t] = idsOf(s, "c", "a", "t");
    expect(spellSelection(s, new Set([a, t, c]))).toEqual({ kind: "word", tiles: "cat", word: "cat" });
  });

  it("已声明的白搭：tiles 写 1/2，word 写声明的字母（报 COD 则白搭当 O）", () => {
    let s = row("c1d");
    const wild = s[1]!.tileId;
    s = declareWild(s, wild, "o");
    expect(spellSelection(s, s.flatMap((e) => (e ? [e.tileId] : [])))).toEqual({
      kind: "word",
      tiles: "c1d",
      word: "cod",
    });
  });

  it("未声明的白搭 → needWild，白搭显示成 ★", () => {
    const s = row("c2t1");
    const ids = [s[0]!.tileId, s[1]!.tileId, s[2]!.tileId];
    expect(spellSelection(s, ids)).toEqual({ kind: "needWild", display: "C★T", wild: { tileId: s[1]!.tileId, kind: "2" } });
  });

  it("不足 2 张不校验（含 1 张未声明白搭的情况）", () => {
    const s = row("c1");
    expect(spellSelection(s, [])).toEqual({ kind: "none" });
    expect(spellSelection(s, [s[0]!.tileId])).toEqual({ kind: "none" });
    expect(spellSelection(s, [s[1]!.tileId])).toEqual({ kind: "none" });
  });

  it("不在散牌区的 id 忽略", () => {
    const s = row("ab");
    expect(spellSelection(s, [s[0]!.tileId, 999])).toEqual({ kind: "none" });
  });

  it("暗词里的牌（groupId 非空）不参与推导，只读散牌", () => {
    const s = row("catxy");
    for (const e of s.slice(0, 3)) if (e) e.groupId = 0;
    const all = s.flatMap((e) => (e ? [e.tileId] : []));
    expect(spellSelection(s, all)).toEqual({ kind: "word", tiles: "xy", word: "xy" });
    // 只选了暗词里的牌：一张散牌都没有，不校验
    expect(spellSelection(s, idsOf(s, "c", "a", "t"))).toEqual({ kind: "none" });
  });

  it("word 一律小写", () => {
    let s = row("c1");
    s = declareWild(s, s[1]!.tileId, "O");
    const r = spellSelection(s, [s[0]!.tileId, s[1]!.tileId]);
    expect(r).toEqual({ kind: "word", tiles: "c1", word: "co" });
  });

  it("key：同一个词同一个 key，顺序变了 key 变", () => {
    const a = row("cat");
    const b = row("act");
    const all = (s: LooseSlots) => s.flatMap((e) => (e ? [e.tileId] : []));
    expect(spellKey(spellSelection(a, all(a)))).toBe(spellKey(spellSelection(row("cat"), all(a))));
    expect(spellKey(spellSelection(a, all(a)))).not.toBe(spellKey(spellSelection(b, all(b))));
  });

  it("两张白搭（不管定没定字母）→ tooManyWilds，不弹选择器", () => {
    let s = row("c12");
    const all = s.flatMap((e) => (e ? [e.tileId] : []));
    expect(spellSelection(s, all)).toEqual({ kind: "tooManyWilds", display: "C★★" });
    s = declareWild(declareWild(s, s[1]!.tileId, "a"), s[2]!.tileId, "t");
    expect(spellSelection(s, all)).toEqual({ kind: "tooManyWilds", display: "CAT" });
  });
});

