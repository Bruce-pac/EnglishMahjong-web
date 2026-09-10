/**
 * T3.4：打牌。
 *
 * 1. 什么状态下允许提交（只读 pending，不判规则）
 * 2. 手里有重复字母时，带着 consumedTileIds 对账，空出的是打出去的那一格
 * 3. 拖到牌河：能打时返回打牌意图，不能打时是非法落点、牌回原位；右键拿同一个意图
 */

import { Group, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { Envelope, Pending, State } from "../api";
import { canDiscard, canPass } from "./discard";
import { fakeAssetLoader } from "./fake-assets";
import { ObjectView } from "./object-view";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";

const pendingOf = (kind: Pending["kind"], can = false): Pending => ({ kind, tile: null, canPass: can, hints: [] });

describe("canDiscard / canPass", () => {
  it("discard 和 reveal 能打；chi、win、没轮到你都不能", () => {
    expect(canDiscard(pendingOf("discard"), false)).toBe(true);
    expect(canDiscard(pendingOf("reveal", true), false)).toBe(true);
    expect(canDiscard(pendingOf("chi", true), false)).toBe(false);
    expect(canDiscard(pendingOf("win", true), false)).toBe(false);
    expect(canDiscard(null, false)).toBe(false);
  });

  it("请求没回来之前锁住", () => {
    expect(canDiscard(pendingOf("discard"), true)).toBe(false);
    expect(canPass(pendingOf("chi", true), true)).toBe(false);
  });

  it("「过」只在 chi / win 且 canPass 时出现", () => {
    expect(canPass(pendingOf("chi", true), false)).toBe(true);
    expect(canPass(pendingOf("win", true), false)).toBe(true);
    expect(canPass(pendingOf("win", false), false)).toBe(false);
    expect(canPass(pendingOf("reveal", true), false)).toBe(false);
    expect(canPass(pendingOf("discard", false), false)).toBe(false);
    expect(canPass(null, false)).toBe(false);
  });
});

function envelopeOf(state: State): Envelope {
  return { matchId: "m-discard", events: [], state, pending: null, result: null, matchFinished: false };
}

/** 拿 fixture 的局面，只把自己的手牌换成指定的（其余几家原样） */
function withHand(hand: string[]): State {
  const state = structuredClone(fixtureGames()[0].steps[2].state);
  state.me.hand = hand;
  state.me.groups = [];
  return state;
}

function newView(): TableView {
  return new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
}

/** 散牌区里某个字母的第 k 张：[槽位, tileId] */
function nth(view: TableView, tile: string, k: number): [number, number] {
  const hits = view.looseSlots.flatMap((e, i) => (e?.tile === tile ? [[i, e.tileId] as [number, number]] : []));
  return hits[k];
}

describe("重复字母：consumedTileIds 决定空出哪一格", () => {
  const before = ["b", "a", "c", "a", "d"];
  const after = ["b", "c", "a", "d"]; // 服务端只知道少了一张 a

  it("打左边那张 a：空出的就是左边那格，右边的 a 和其他牌一格不动", () => {
    const view = newView();
    view.apply(envelopeOf(withHand(before)));
    const [leftSlot, leftId] = nth(view, "a", 0);
    const [rightSlot, rightId] = nth(view, "a", 1);
    const others = view.looseSlots.map((e, i) => [i, e?.tileId] as const).filter(([, id]) => id !== undefined && id !== leftId);

    view.apply(envelopeOf(withHand(after)), [leftId]);
    expect(view.looseSlots[leftSlot]).toBeNull();
    expect(view.looseSlots[rightSlot]?.tileId).toBe(rightId);
    for (const [i, id] of others) expect(view.looseSlots[i]?.tileId).toBe(id);
  });

  it("对照：不带 consumedTileIds 时按从左到右取，空出的是另一格", () => {
    const view = newView();
    view.apply(envelopeOf(withHand(before)));
    const [leftSlot, leftId] = nth(view, "a", 0);
    const [rightSlot] = nth(view, "a", 1);
    view.apply(envelopeOf(withHand(after)));
    expect(view.looseSlots[leftSlot]?.tileId).toBe(leftId);
    expect(view.looseSlots[rightSlot]).toBeNull();
  });

  it("空格留在原地不压实；新摸的牌出现在右端", () => {
    const view = newView();
    view.apply(envelopeOf(withHand(before)));
    const [leftSlot, leftId] = nth(view, "a", 0);
    view.apply(envelopeOf(withHand(after)), [leftId]);
    view.apply(envelopeOf(withHand([...after, "z"])));
    expect(view.looseSlots[leftSlot]).toBeNull();
    const filled = view.looseSlots.flatMap((e, i) => (e ? [i] : []));
    expect(view.looseSlots[filled[filled.length - 1]]?.tile).toBe("z");
  });
});

describe("拖到牌河 / 右键", () => {
  function setup(allowed: boolean) {
    const view = newView();
    view.apply(envelopeOf(fixtureGames()[0].steps[2].state));
    view.setDiscardAllowed(allowed);
    return view;
  }

  function dragToRiver(view: TableView) {
    const t = view.pickables[0];
    view.setHovered(t.id);
    expect(view.dragStart(t.place.position.clone())).toBe(true);
    const river = view.slots.get("discard.0.2@0")!.place(0).position;
    view.dragMove(new Vector3(river.x, river.y, t.place.position.z));
    return { t, intent: view.dragEnd() };
  }

  it("能打时返回这张牌的 tileId 和牌面；本地局面先不动，等 envelope", () => {
    const view = setup(true);
    const before = view.looseSlots.map((e) => e?.tileId ?? null);
    const { t, intent } = dragToRiver(view);
    const expected = view.discardIntentOf(t.id);
    expect(intent).toEqual(expected);
    expect(intent!.tile).toBe(view.looseSlots.find((e) => e?.tileId === intent!.tileId)!.tile);
    expect(view.looseSlots.map((e) => e?.tileId ?? null)).toEqual(before);
    expect(view.dragging).toBe(false);
  });

  it("不能打时（没轮到你 / 等吃胡决策 / 请求在路上）是非法落点，牌回原位", () => {
    const view = setup(false);
    const before = view.looseSlots.map((e) => e?.tileId ?? null);
    const { intent } = dragToRiver(view);
    expect(intent).toBeNull();
    expect(view.looseSlots.map((e) => e?.tileId ?? null)).toEqual(before);
  });

  it("在散牌区内拖动仍然是重排，不会变成打牌", () => {
    const view = setup(true);
    const t = view.pickables[0];
    view.setHovered(t.id);
    view.dragStart(t.place.position.clone());
    const to = view.slots.get("loose.16@0")!.place(0).position;
    view.dragMove(new Vector3(to.x, to.y, t.place.position.z));
    expect(view.dragEnd()).toBeNull();
  });

  it("右键：不在自己散牌区的牌没有打牌意图", () => {
    const view = setup(true);
    const other = [...view.slotNames].find(([, n]) => !(n.startsWith("loose.") && n.endsWith("@0")))![0];
    expect(view.discardIntentOf(other)).toBeNull();
    expect(view.discardIntentOf(view.pickables[0].id)).not.toBeNull();
  });
});
