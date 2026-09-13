/** T6.1：吃牌时把打出的词对应到手里的牌 */

import { Group } from "three";
import { describe, expect, it } from "vitest";
import type { Envelope, State } from "../api";
import { claimSubmission, matchChi, matchHint, matchWin } from "./chi";
import { fakeAssetLoader } from "./fake-assets";
import { LOOSE_SLOTS } from "./layout";
import { declareWild, type LooseSlots } from "./loose-reconcile";
import { ObjectView } from "./object-view";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";

/** `.` 是空格；每个字符按出现顺序发 tileId（从 1 起）；`groups` 里的格子标成暗词 */
function row(pattern: string, groups: number[][] = []): LooseSlots {
  let id = 1;
  const out: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
  [...pattern.padEnd(LOOSE_SLOTS, ".")].forEach((c, i) => {
    if (c !== ".") out[i] = { tileId: id++, tile: c };
  });
  groups.forEach((slots, gid) => {
    for (const i of slots) out[i] = { ...out[i]!, groupId: gid, groupKey: `k${gid}` };
  });
  return out;
}
const idAt = (s: LooseSlots, i: number) => s[i]!.tileId;

describe("matchChi", () => {
  it("重复字母时挑最靠右的那张", () => {
    const s = row("a.cax");
    // 吃 T 拼 CAT：A 挑第 3 格（右边那张），C 在第 2 格
    expect(matchChi(s, "cat", "t")).toEqual({ ok: true, handTiles: "ca", tiles: "cat", tileIds: [idAt(s, 2), idAt(s, 3)] });
  });

  it("暗词里的牌不用；散牌缺这个字母时报失败，不去暗词里借", () => {
    const s = row("cat.a", [[0, 1, 2]]);
    // 暗词 CAT 里有 C，散牌里没有 → 凑不出 CAT
    expect(matchChi(s, "cat", "t")).toEqual({ ok: false, reason: "missing" });
    // A 用散牌里那张（第 4 格），不用暗词里的
    const t = row("cat.a.c", [[0, 1, 2]]);
    expect(matchChi(t, "cat", "t")).toMatchObject({ ok: true, tileIds: [idAt(t, 6), idAt(t, 4)] });
  });

  it("真字母优先于白搭", () => {
    const s = row("1ca");
    expect(matchChi(s, "cat", "t")).toMatchObject({ ok: true, handTiles: "ca", tileIds: [idAt(s, 1), idAt(s, 2)] });
  });

  it("白搭种类不对不用", () => {
    const s = row("c2"); // 缺 A，只有辅音白搭
    expect(matchChi(s, "cat", "t")).toEqual({ ok: false, reason: "missing" });
    const v = row("c1"); // 元音白搭可以当 A
    expect(matchChi(v, "cat", "t")).toMatchObject({ ok: true, handTiles: "c1", tiles: "c1t" });
  });

  it("多张可选的白搭时，优先挑声明字母正好相同的那张", () => {
    let s = row("c111");
    s = declareWild(declareWild(s, idAt(s, 1), "a"), idAt(s, 2), "o");
    // 三张元音白搭：第 1 格定 A、第 2 格定 O、第 3 格未定 → CAT 要 A，挑第 1 格
    expect(matchChi(s, "cat", "t")).toMatchObject({ ok: true, tileIds: [idAt(s, 0), idAt(s, 1)] });
    // 没有声明相同的：挑最靠右的
    expect(matchChi(s, "cut", "t")).toMatchObject({ ok: true, tileIds: [idAt(s, 0), idAt(s, 3)] });
  });

  it("打出的那张认领自己的字母；词里没用上打出的那张 → 失败", () => {
    const s = row("tac");
    // 打出的是 T：它认领 T 的位置，手里那张 T 不用
    expect(matchChi(s, "cat", "t")).toMatchObject({ ok: true, handTiles: "ca", tileIds: [idAt(s, 2), idAt(s, 1)] });
    expect(matchChi(s, "cat", "x")).toEqual({ ok: false, reason: "discardUnused" });
  });

  it("打出的那张是白搭：真字母认领完，它认领剩下那一位", () => {
    const s = row("ct");
    expect(matchChi(s, "cat", "1")).toEqual({ ok: true, handTiles: "ct", tiles: "ct1", tileIds: [idAt(s, 0), idAt(s, 1)] });
    // 种类对不上：辅音白搭当不了 A
    expect(matchChi(s, "cat", "2")).toEqual({ ok: false, reason: "missing" });
    // 词里没有它能代替的空位（全被真字母填满）
    expect(matchChi(row("cat"), "cat", "1")).toEqual({ ok: false, reason: "discardUnused" });
  });

  it("白搭超额（打出的那张白搭也算）→ 失败", () => {
    expect(matchChi(row("12"), "cat", "t")).toEqual({ ok: false, reason: "tooManyWilds" });
    expect(matchChi(row("c2"), "cat", "1")).toEqual({ ok: false, reason: "tooManyWilds" });
  });

  it("空输入 / 非字母 → empty", () => {
    expect(matchChi(row("cat"), "", "t")).toEqual({ ok: false, reason: "empty" });
    expect(matchChi(row("cat"), "c-t", "t")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("吃牌亮词成功后的对账", () => {
  it("有重复字母时，移除的正是对应出来的那几个 tileId（右边那张 A），左边那张原地不动", () => {
    const view = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    const base = fixtureGames()[0].steps[2].state;
    const stateWith = (hand: string[]): State => {
      const st = structuredClone(base);
      st.me.hand = hand;
      st.me.groups = [];
      return st;
    };
    const env = (st: State): Envelope => ({ matchId: "m-chi", events: [], state: st, pending: null, result: null, matchFinished: false });
    view.apply(env(stateWith(["a", "c", "a", "x"])));
    const before = view.looseSlots;
    const m = matchChi(before, "cat", "t");
    if (!m.ok) throw new Error("应该对应得上");
    const leftA = before.findIndex((e) => e?.tile === "a");
    const rightA = before.findIndex((e, i) => e?.tile === "a" && i > leftA);
    expect(m.tileIds).toContain(before[rightA]!.tileId);
    // 服务端：手里少了一张 a、一张 c（T 是打出的那张，吃进来又亮出去）
    view.apply(env(stateWith(["a", "x"])), m.tileIds);
    expect(view.looseSlots[rightA]).toBeNull();
    expect(view.looseSlots[leftA]?.tileId).toBe(before[leftA]!.tileId);
  });
});

describe("吃牌高亮", () => {
  it("高亮走 Custom 轨的 emissive，不是选中（不触发框选校验）", () => {
    const objectView = new ObjectView(new Group(), fakeAssetLoader());
    const view = new TableView(objectView, makeSlots());
    const st = structuredClone(fixtureGames()[0].steps[2].state);
    st.me.hand = ["a", "c", "a", "x"];
    st.me.groups = [];
    view.apply({ matchId: "m-hl", events: [], state: st, pending: null, result: null, matchFinished: false });
    const m = matchChi(view.looseSlots, "cat", "t");
    if (!m.ok) throw new Error("应该对应得上");
    view.setHighlight(m.tileIds);
    expect(view.selectedTileIds()).toEqual([]);
    const lit = objectView.mainGroup.children.filter(
      (c) => c.type === "Mesh" && c.visible && (c as unknown as { material: { emissive?: { r: number } } }).material.emissive?.r! > 0.2,
    );
    expect(lit).toHaveLength(2);
    view.setHighlight([]);
    const still = objectView.mainGroup.children.filter((c) => c.type === "Mesh" && c.visible && c.name !== "dropShadow");
    expect(still.filter((c) => (c as unknown as { material: { emissive?: { r: number } } }).material.emissive?.r! > 0.2)).toHaveLength(0);
  });
});

describe("matchWin（胡牌：必须用光全部散牌）", () => {
  it("散牌 A + 要胡的 T → AT：用光散牌才成功；暗词里的牌不算散牌", () => {
    const s = row("cat.a", [[0, 1, 2]]);
    expect(matchWin(s, "at", "t")).toEqual({ ok: true, handTiles: "a", tiles: "at", tileIds: [idAt(s, 4)] });
  });

  it("少用一张散牌 → notAll（不说剩的是哪张）", () => {
    const s = row("ab");
    expect(matchWin(s, "at", "t")).toEqual({ ok: false, reason: "notAll" });
    // 吃牌就不要求用光
    expect(matchChi(s, "at", "t")).toMatchObject({ ok: true });
  });

  it("重复字母：两张都得用上", () => {
    const s = row("aab");
    expect(matchWin(s, "baa", "t")).toEqual({ ok: false, reason: "discardUnused" });
    expect(matchWin(s, "abat", "t")).toMatchObject({ ok: true, handTiles: "aba" });
    expect(matchWin(s, "bat", "t")).toEqual({ ok: false, reason: "notAll" });
  });

  it("白搭：种类对得上才用；要胡的那张是白搭时最后认领", () => {
    expect(matchWin(row("c1"), "cat", "t")).toMatchObject({ ok: true, handTiles: "c1", tiles: "c1t" });
    expect(matchWin(row("c2"), "cat", "t")).toEqual({ ok: false, reason: "missing" });
    expect(matchWin(row("ct"), "cat", "1")).toMatchObject({ ok: true, tiles: "ct1" });
    // 要胡的元音白搭认领 A 之后，T 还缺一张辅音白搭 → 缺牌
    expect(matchWin(row("c1"), "cat", "1")).toEqual({ ok: false, reason: "missing" });
    // 两张元音白搭分别当 E、A，散牌也用光了，但白搭超额
    expect(matchWin(row("t1"), "eat", "1")).toEqual({ ok: false, reason: "tooManyWilds" });
  });

  it("词比手里的牌还长 → missing", () => {
    expect(matchWin(row("a"), "cart", "t")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("matchHint（提示词：没有桌上那张，只从散牌里挑）", () => {
  it("用 wild 指定的字母补白搭：COD（★=O）用到 C、白搭、D", () => {
    const s = row("c1dx");
    expect(matchHint(s, "cod", "o")).toEqual({ ok: true, handTiles: "c1d", tiles: "c1d", tileIds: [idAt(s, 0), idAt(s, 1), idAt(s, 2)] });
  });

  it("白搭只能代 wild 指定的那个字母：服务端说 ★=A，那 O 那一位就补不上", () => {
    expect(matchHint(row("c1d"), "cod", "a")).toEqual({ ok: false, reason: "missing" });
  });

  it("真字母优先：散牌里有 O 就不用白搭；同字母挑最靠右", () => {
    const s = row("oc1do");
    expect(matchHint(s, "cod", "o")).toMatchObject({ ok: true, handTiles: "cod", tileIds: [idAt(s, 1), idAt(s, 4), idAt(s, 3)] });
  });

  it("要用到暗词里的牌 → 对应失败（界面注明要先拆开暗词）", () => {
    const s = row("cat.x", [[0, 1, 2]]);
    expect(matchHint(s, "cat")).toEqual({ ok: false, reason: "missing" });
  });

  it("没有 wild 的提示照常对应；白搭种类不对不用", () => {
    expect(matchHint(row("cat"), "cat")).toMatchObject({ ok: true, handTiles: "cat" });
    expect(matchHint(row("c2t"), "cat", "a")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("claimSubmission（提交什么、对账移除哪几张）", () => {
  it("提示模式吃牌：带 viaHint: true，consumedTileIds 是对应出来的那几张（重复字母挑右边的）", () => {
    const s = row("a.cax");
    const m = matchChi(s, "cat", "t");
    if (!m.ok) throw new Error("应该对应得上");
    expect(claimSubmission("chi", m, "cat", undefined, true)).toEqual({
      body: { kind: "chi", tiles: "cat", word: "cat", expansion: undefined, viaHint: true },
      consumedTileIds: [idAt(s, 2), idAt(s, 3)],
    });
  });

  it("非提示模式吃牌：不带 viaHint", () => {
    const m = matchChi(row("ca"), "cat", "t");
    if (!m.ok) throw new Error("应该对应得上");
    expect(claimSubmission("chi", m, "cat").body).not.toHaveProperty("viaHint");
  });

  it("胡牌：只报词和全称，不移除任何牌", () => {
    const m = matchWin(row("a"), "at", "t");
    if (!m.ok) throw new Error("应该对应得上");
    expect(claimSubmission("win", m, "at", "x")).toEqual({ body: { kind: "win", word: "at", expansion: "x" }, consumedTileIds: [] });
  });
});

