/** T5.2：回放期间可操作，只锁提交（TableView 层） */

import { Group, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { Envelope, State } from "../api";
import { fakeAssetLoader } from "./fake-assets";
import { ObjectView } from "./object-view";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames, slotOf, suffixShiftError, wildOf } from "./test-helpers";

const envOf = (state: State): Envelope => ({ matchId: "m-t52", events: [], state, pending: null, result: null, matchFinished: false });

function withHand(hand: string[]): State {
  const s = structuredClone(fixtureGames()[0].steps[2].state);
  s.me.hand = hand;
  s.me.groups = [];
  return s;
}

/** 只改别家的一步：座位 1 打出一张（自己的 hand 不变，对账是空操作） */
function otherDiscards(s: State): State {
  const n = structuredClone(s);
  const o = n.others[0];
  o.handCount -= 1;
  n.discards.push("q");
  n.discardSeats.push(o.seat);
  return n;
}

function setup(hand: string[]) {
  const view = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
  const state = withHand(hand);
  view.apply(envOf(state));
  const slotPos = (i: number) => view.slots.get(`loose.${i}@0`)!.place(0).position.clone();
  /** 散牌区第 k 张某字母：[槽位, tileId] */
  const nth = (tile: string, k = 0) => view.looseSlots.flatMap((e, i) => (e?.tile === tile ? [[i, e.tileId] as const] : []))[k];
  const thingAt = (i: number) => view.pickables.find((t) => t.place.position.equals(slotPos(i)))!.id;
  /** 拿起第 i 格的牌，挪到第 to 格上方（还没松手） */
  const pick = (i: number, to: number) => {
    view.setHovered(thingAt(i));
    expect(view.dragStart(slotPos(i))).toBe(true);
    view.dragMove(slotPos(to));
  };
  return { view, state, slotPos, nth, thingAt, pick };
}

const ids = (view: TableView) => view.looseSlots.map((e) => e?.tileId ?? null);

describe("拖动跨 apply 存活", () => {
  const hand = ["c", "a", "t", "d", "o", "g"];

  it("只改别家的一步：仍在拖动，落下的结果与没被打断时相同", () => {
    const plain = setup(hand);
    const [from] = plain.nth("c");
    const to = from + 4;
    plain.pick(from, to);
    plain.view.dragEnd();

    const hit = setup(hand);
    hit.pick(from, to);
    hit.view.apply(envOf(otherDiscards(hit.state)));
    expect(hit.view.dragging).toBe(true);
    hit.view.apply(envOf(otherDiscards(otherDiscards(hit.state))));
    expect(hit.view.dragging).toBe(true);
    hit.view.dragEnd();
    expect(ids(hit.view)).toEqual(ids(plain.view));
  });

  it("自己摸了一张：仍在拖动；新牌照常从右端进来（不变式 3、4），落下后两张都在", () => {
    const t = setup([...hand, "1"]);
    t.view.declareWildTile(t.nth("1")[1], "e");
    const [from, heldId] = t.nth("a");
    t.pick(from, from + 3);

    const before = t.view.looseSlots;
    t.view.apply(envOf(withHand([...hand, "1", "z"])));
    expect(t.view.dragging).toBe(true);
    expect(t.view.heldTileId).toBe(heldId);
    // 对账这一步：幸存的牌只往左让位、动的是后缀；白搭声明不串
    expect(suffixShiftError(slotOf(before), slotOf(t.view.looseSlots))).toBeNull();
    const wild = wildOf(t.view.looseSlots);
    for (const [id, w] of wildOf(before)) expect(wild.get(id)).toBe(w);

    t.view.dragEnd();
    const after = t.view.looseSlots;
    expect(after.some((e) => e?.tile === "z")).toBe(true);
    expect(after.some((e) => e?.tileId === heldId)).toBe(true);
    // 写回的是**当时**的 LooseSlots：摸到的 z 没被落下这一下冲掉，张数 = 手牌数
    expect(after.filter(Boolean).length).toBe(hand.length + 2);
  });

  it("手上那张被拿走了（consumedTileIds 里有它）：拖动取消", () => {
    const t = setup(hand);
    const [from, heldId] = t.nth("t");
    t.pick(from, from + 2);
    t.view.apply(envOf(withHand(hand.filter((x) => x !== "t"))), [heldId]);
    expect(t.view.dragging).toBe(false);
    expect(t.view.looseSlots.some((e) => e?.tileId === heldId)).toBe(false);
  });

  it("实例被重新分配（同字母两张、C 层对调）：apply 后仍拿着同一个 tileId", () => {
    const t = setup(["a", "b", "a", "c"]);
    const [i, heldId] = t.nth("a", 0);
    const [j] = t.nth("a", 1);
    const thingI = t.thingAt(i);
    const thingJ = t.thingAt(j);
    t.pick(i, i + 5);
    // pinned 让两格互换实例：局面不变，但 loose.i 现在由原来 loose.j 的 Thing 来演
    t.view.apply(envOf(withHand(["a", "b", "a", "c"])), [], new Map([
      [`loose.${i}@0`, `loose.${j}@0`],
      [`loose.${j}@0`, `loose.${i}@0`],
    ]));
    const thingAtSlot = (k: number) => [...t.view.slotNames].find(([, n]) => n === `loose.${k}@0`)![0];
    expect(thingAtSlot(i)).toBe(thingJ); // 真的对调了
    expect(thingAtSlot(j)).toBe(thingI);
    expect(t.view.dragging).toBe(true);
    expect(t.view.heldTileId).toBe(heldId);
    t.view.dragEnd();
    expect(t.view.looseSlots[i + 5]?.tileId).toBe(heldId);
  });

  it("拿着的牌被右端挤空隙挪了一格：牌仍在手指下，鼠标不动松手就落在指着的那格", () => {
    // 16 张居中铺在第 1–16 格（第 0 格空）；再摸一张进第 17 格，右端满了
    const letters = [..."abcdefghijklmnop"];
    const t = setup(letters);
    t.view.apply(envOf(withHand([...letters, "q"])));
    const [from, heldId] = t.nth("p"); // 第 16 格
    const to = 10;
    t.pick(from, to);
    // 再摸一张：右端没空位，整排从右往里挤掉第 0 格那个空隙——拿着的 p 跟着左移一格
    t.view.apply(envOf(withHand([...letters, "q", "r"])));
    expect(t.view.looseSlots.findIndex((e) => e?.tileId === heldId)).toBe(from - 1);
    expect(t.view.dragging).toBe(true);
    // 鼠标一直没动。按下位置跟着平移了，牌还捏在手指下，落点就是指着的第 10 格；
    // 不平移的话牌会离手指一格、落到第 9 格（审查变异 D2）
    t.view.dragEnd();
    expect(t.view.looseSlots[to]?.tileId).toBe(heldId);
  });
});

describe("回放期间只锁提交", () => {
  it("打牌意图被挡（右键、拖到牌河）；重排、白搭赋值、框选照常；解锁后恢复", () => {
    const t = setup(["c", "a", "t", "1"]);
    t.view.setDiscardAllowed(true);
    t.view.setSubmitLocked(true);
    const [ci] = t.nth("c");
    expect(t.view.discardIntentOf(t.thingAt(ci))).toBeNull();

    // 拖到牌河：非法落点，牌回原位，不给打牌意图
    const before = ids(t.view);
    t.view.setHovered(t.thingAt(ci));
    t.view.dragStart(t.slotPos(ci));
    const river = t.view.slots.get("discard.0.2@0")!.place(0).position;
    t.view.dragMove(new Vector3(river.x, river.y, 0));
    expect(t.view.dragEnd()).toBeNull();
    expect(ids(t.view)).toEqual(before);

    // 本地操作照常
    t.pick(ci, ci + 6);
    t.view.dragEnd();
    expect(ids(t.view)).not.toEqual(before);
    expect(t.view.declareWildTile(t.nth("1")[1], "o")).toBe(true);
    expect(t.view.setSelected([t.thingAt(t.nth("a")[0])])).toBe(true);
    expect(t.view.selectedTileIds()).toEqual([t.nth("a")[1]]);

    t.view.setSubmitLocked(false);
    expect(t.view.discardIntentOf(t.thingAt(t.nth("t")[0]))).toMatchObject({ tile: "t" });
  });
});
