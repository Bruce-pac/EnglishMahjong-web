/**
 * T3.2：拖放重排。
 *
 * 守四件事：
 * 1. `insertLoose` 的插入让位语义（先左后右、不压实别处空格、白搭跟着 tileId 走）
 * 2. `findSlot` 的重叠面积打分
 * 3. `Movement.tryShift` 的预览与 `insertLoose` 落下后的结果**逐格一致**——
 *    两套实现一旦分叉，玩家看到的预览和松手后的结果就对不上
 * 4. **拖动之后拿同一个 envelope 再对账一次，散牌区一格都不变**
 */

import { Group, Vector3 } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope, State } from "../api";
import { fakeAssetLoader } from "./fake-assets";
import { LOOSE_SLOTS } from "./layout";
import { insertLoose, type LooseSlots } from "./loose-reconcile";
import { findSlot, Movement } from "./movement";
import { ObjectView } from "./object-view";
import * as persist from "./persist";
import { makeSlots } from "./setup-slots";
import type { Slot } from "./slot";
import { TableView } from "./table-view";
import { fixtureGames, rng, slotOf } from "./test-helpers";
import { Thing } from "./thing";
import { ThingType } from "./types";

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

/** 用字符串造一排：`.` 是空格，其余字母各发一个 tileId（按出现顺序从 1 起） */
function row(pattern: string): LooseSlots {
  let id = 1;
  const out: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
  [...pattern.padEnd(LOOSE_SLOTS, ".")].forEach((c, i) => {
    if (c !== ".") out[i] = { tileId: id++, tile: c };
  });
  return out;
}
const show = (s: LooseSlots | null) => (s ? s.map((e) => e?.tile ?? ".").join("") : null);

describe("insertLoose", () => {
  it("目标格空着就直接放，别的牌不动", () => {
    expect(show(insertLoose(row("..abc...."), 2, 7))).toBe(show(row("...bc..a.")));
  });

  it("目标格有牌：占位的那截先往左让，一直让到最近的空格", () => {
    // 把 d 插到 b 的位置：b 往左挤 a，a 挪进第 0 格的空格；右边 c、e 不动
    expect(show(insertLoose(row(".ab.cde"), 5, 2))!.slice(0, 7)).toBe("abd.c.e");
    // 左邻就是空格时只动占位那一张
    expect(show(insertLoose(row("..a.bcd"), 6, 4))!.slice(0, 7)).toBe("..abdc.");
  });

  it("左边一路满到头就改往右让", () => {
    // 把 x 插到 b 的位置：左边 a 贴着第 0 格走不通，改往右挤进第 4 格的空格
    expect(show(insertLoose(row("abcd.x"), 5, 1))!.slice(0, 6)).toBe("axbcd.");
  });

  it("离开的那格算空格：往右拖一格就是和右邻换位", () => {
    expect(show(insertLoose(row("..abcd"), 2, 3))!.slice(0, 6)).toBe("..bacd");
  });

  it("整排满了且另一张没腾出空的方向时返回 null", () => {
    // 18 格全满：from 自己腾出的那格总是空的，所以只要 from 在某一侧就走得通
    const full = row("abcdefghijklmnopqr");
    expect(insertLoose(full, 0, 17)).not.toBeNull();
    // 空的 from、越界都拒绝
    expect(insertLoose(row("a"), 3, 0)).toBeNull();
    expect(insertLoose(row("a"), 0, 99)).toBeNull();
  });

  it("tileId 不变、白搭声明跟着 tileId 走、别处的空格不压实", () => {
    const s = row("..a1b...c..d");
    s[3] = { ...s[3]!, wildLetter: "e" };
    const next = insertLoose(s, 3, 9)!;
    const moved = next.find((e) => e?.tile === "1")!;
    expect(moved.tileId).toBe(s[3]!.tileId);
    expect(moved.wildLetter).toBe("e");
    expect(next.indexOf(moved)).toBe(9);
    // 多重集不变
    expect(next.filter(Boolean).map((e) => e!.tileId).sort()).toEqual(
      s.filter(Boolean).map((e) => e!.tileId).sort(),
    );
    // 与 from、to 无关的空格原样留着
    expect(next[0]).toBeNull();
    expect(next[1]).toBeNull();
    expect(next[15]).toBeNull();
  });
});

/** 自己散牌区那一排，按下标排好 */
function looseRow(slots: Map<string, Slot>): Slot[] {
  return [...slots.values()]
    .filter((s) => s.group === "loose" && s.seat === 0)
    .sort((a, b) => a.indexes[0] - b.indexes[0]);
}

describe("findSlot", () => {
  const slots = makeSlots();
  const lrow = looseRow(slots);
  const size = lrow[0].place(0).size;

  it("正对格子就落在那一格", () => {
    for (const s of lrow) {
      const p = s.place(0).position;
      expect(findSlot(lrow, p.x, p.y, size.x, size.y)).toBe(s);
    }
  });

  it("偏了不到半格还吸在原格，过了半格吸到邻格", () => {
    const p = lrow[5].place(0).position;
    expect(findSlot(lrow, p.x + size.x * 0.4, p.y, size.x, size.y)).toBe(lrow[5]);
    expect(findSlot(lrow, p.x + size.x * 0.6, p.y, size.x, size.y)).toBe(lrow[6]);
  });

  it("离格子还有一点距离也能吸上（外扩半个牌宽），离远了就没有落点", () => {
    const p = lrow[5].place(0).position;
    expect(findSlot(lrow, p.x, p.y + size.y * 1.1, size.x, size.y)).toBe(lrow[5]);
    expect(findSlot(lrow, p.x, p.y + size.y * 3, size.x, size.y)).toBeNull();
  });

  it("候选之外的格子不收：拖到牌河上方没有落点", () => {
    const discard = [...slots.values()].find((s) => s.group === "discard" && s.seat === 0)!;
    const p = discard.place(0).position;
    expect(findSlot(lrow, p.x, p.y, size.x, size.y)).toBeNull();
  });
});

describe("Movement.tryShift 与 insertLoose 逐格一致", () => {
  /** 按 LooseSlots 在新槽位上摆 Thing，跑一次 Movement，读回预览后的一排 */
  function preview(s: LooseSlots, from: number, to: number): LooseSlots | null {
    const slots = makeSlots();
    const lrow = looseRow(slots);
    const things: Thing[] = [];
    const byThing = new Map<Thing, NonNullable<LooseSlots[number]>>();
    s.forEach((e, i) => {
      if (!e) return;
      const t = new Thing(things.length, ThingType.TILE, 0, lrow[i]);
      things.push(t);
      byThing.set(t, e);
    });
    const held = lrow[from].thing!;
    const m = new Movement();
    m.move(held, lrow[to]);
    if (!m.findShift(things) || !m.valid()) return null;

    const out: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
    for (const t of things) {
      const slot = t === held ? lrow[to] : (m.shifts().get(t) ?? t.slot);
      expect(out[slot.indexes[0]], "两张牌抢同一格").toBeNull();
      out[slot.indexes[0]] = byThing.get(t)!;
    }
    // Movement 不许碰世界状态
    for (const t of things) expect(t.slot.thing).toBe(t);
    return out;
  }

  it("随机的排列 × 全部起止格", () => {
    const rand = rng(32);
    for (let round = 0; round < 40; round++) {
      const letters = [...Array(LOOSE_SLOTS)].map(() => (rand() < 0.7 ? "abcdefg"[Math.floor(rand() * 7)] : "."));
      const s = row(letters.join(""));
      for (let from = 0; from < LOOSE_SLOTS; from++) {
        if (!s[from]) continue;
        for (let to = 0; to < LOOSE_SLOTS; to++) {
          if (to === from) continue;
          const a = insertLoose(s, from, to);
          const b = preview(s, from, to);
          expect(slotOf(b ?? []), `${show(s)} ${from}→${to}`).toEqual(slotOf(a ?? []));
        }
      }
    }
  });
});

describe("TableView 拖放", () => {
  function envelopeOf(state: State): Envelope {
    return { matchId: "m-drag", events: [], state, pending: null, result: null, matchFinished: false };
  }

  function setup() {
    const view = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    const state = fixtureGames()[0].steps[2].state;
    const env = envelopeOf(state);
    view.apply(env);
    return { view, env };
  }

  /** 把第 from 格的牌拖到第 to 格的正上方松手 */
  function drag(view: TableView, from: number, to: number): void {
    const a = view.slots.get(`loose.${from}@0`)!.place(0).position;
    const b = view.slots.get(`loose.${to}@0`)!.place(0).position;
    const id = view.pickables.find((t) => t.place.position.equals(a))!.id;
    view.setHovered(id);
    expect(view.dragStart(new Vector3(a.x, a.y, 4))).toBe(true);
    view.dragMove(new Vector3(b.x, b.y, 4));
    view.dragEnd();
  }

  it("落下写回 LooseSlots，与 insertLoose 一致，并且存了档", () => {
    const { view } = setup();
    const before = view.looseSlots;
    const from = before.findIndex(Boolean);
    const to = from + 4;
    drag(view, from, to);
    expect(slotOf(view.looseSlots)).toEqual(slotOf(insertLoose(before, from, to)!));
    expect(slotOf(persist.load("m-drag")!.loose)).toEqual(slotOf(view.looseSlots));
    // Thing 也挪到位了
    const tileAt = (i: number) => view.slotNames.size && [...view.slotNames].find(([, n]) => n === `loose.${i}@0`);
    expect(tileAt(to)).toBeTruthy();
  });

  it("关键：拖完再拿同一个 envelope 对账，散牌区一格都不变", () => {
    const { view, env } = setup();
    const from = view.looseSlots.findIndex(Boolean);
    drag(view, from, from + 5);
    drag(view, from + 5, from + 1);
    const after = slotOf(view.looseSlots);
    view.apply(env);
    expect(slotOf(view.looseSlots)).toEqual(after);
  });

  it("刷新（新 TableView 读存档）后排好的顺序还在", () => {
    const { view, env } = setup();
    const from = view.looseSlots.findIndex(Boolean);
    drag(view, from, from + 6);
    const after = slotOf(view.looseSlots);
    const fresh = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    fresh.apply(env);
    expect(slotOf(fresh.looseSlots)).toEqual(after);
  });

  it("拖出这一排就取消，牌回原位", () => {
    const { view } = setup();
    const before = slotOf(view.looseSlots);
    const from = view.looseSlots.findIndex(Boolean);
    const a = view.slots.get(`loose.${from}@0`)!.place(0).position;
    const id = view.pickables.find((t) => t.place.position.equals(a))!.id;
    view.setHovered(id);
    view.dragStart(new Vector3(a.x, a.y, 4));
    view.dragMove(new Vector3(a.x, a.y + 60, 4)); // 拖到牌河那边
    view.dragEnd();
    expect(slotOf(view.looseSlots)).toEqual(before);
    expect(view.dragging).toBe(false);
  });

  it("没指着牌按下不会拿起", () => {
    const { view } = setup();
    expect(view.dragStart(new Vector3(0, 0, 4))).toBe(false);
  });
});
