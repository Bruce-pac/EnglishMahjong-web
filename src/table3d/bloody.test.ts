/** T6.5 血战到底：别家摊开的暗词留空、「第 N 胡」标记、自己胡了之后锁住散牌区 */

import { Group } from "three";
import { describe, expect, it } from "vitest";
import type { Envelope, State } from "../api";
import { fakeAssetLoader } from "./fake-assets";
import { LOOSE_SLOTS, TILE_COUNT } from "./layout";
import { ObjectView } from "./object-view";
import { layout } from "./placement";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";
import { AI_NAMES } from "./names";
import { winMarkers } from "./win-marker";

type Other = State["others"][number];

function stateWith(others: Partial<Other>[], me: Partial<State["me"]> = {}): State {
  const state = structuredClone(fixtureGames()[0].steps[2].state);
  Object.assign(state.me, me);
  state.others = state.others.map((o, k) => ({ ...o, ...(others[k] ?? {}) }));
  return state;
}

/** 某家散牌区的格号 → 朝向（0 正面 / 1 背面） */
function looseOf(state: State, seat: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of layout(state, new Array(LOOSE_SLOTS).fill(null), { lowercase: false })) {
    const m = p.slotName.match(/^loose\.(\d+)@(\d)$/);
    if (m && Number(m[2]) === seat) out.set(Number(m[1]), p.rotationIndex);
  }
  return out;
}

describe("别家摊开的暗词之间空一格", () => {
  it("CAT、ON：词与词之间空一格", () => {
    const s = stateWith([{ handCount: 5, won: true, winOrder: 0, concealed: [{ tiles: "act", word: "CAT" }, { tiles: "no", word: "ON" }] }]);
    const seat = s.others[0].seat;
    expect([...looseOf(s, seat).keys()]).toEqual([0, 1, 2, 4, 5]);
  });

  it("荒牌：背面牌接在最后一个词后面、也空一格，总张数等于 handCount", () => {
    const s = stateWith([{ handCount: 7, concealed: [{ tiles: "act", word: "CAT" }] }]);
    const row = looseOf(s, s.others[0].seat);
    expect([...row.entries()]).toEqual([
      [0, 0], [1, 0], [2, 0],
      [4, 1], [5, 1], [6, 1], [7, 1],
    ]);
  });

  it("连空格放不下 18 格就退回不留空", () => {
    // 7 个两字母词 = 14 张 + 6 个空格 = 20 > 18
    const words = ["at", "be", "do", "go", "hi", "no", "up"].map((w) => ({ tiles: [...w].sort().join(""), word: w.toUpperCase() }));
    const s = stateWith([{ handCount: 14, won: true, winOrder: 1, concealed: words }]);
    expect([...looseOf(s, s.others[0].seat).keys()]).toEqual(Array.from({ length: 14 }, (_, i) => i));
  });

  it("三家同时摊开，全桌张数仍不超过 Thing 池", () => {
    const words = [{ tiles: "act", word: "CAT" }, { tiles: "dgo", word: "DOG" }];
    const s = stateWith([
      { handCount: 6, won: true, winOrder: 0, concealed: words },
      { handCount: 9, concealed: words },
      { handCount: 13, concealed: [] },
    ]);
    const all = layout(s, new Array(LOOSE_SLOTS).fill(null), { lowercase: false });
    for (const o of s.others) expect(looseOf(s, o.seat).size).toBe(o.handCount);
    expect(all.length).toBeLessThanOrEqual(TILE_COUNT);
  });
});

describe("「第 N 胡」标记", () => {
  // P4 起 AI 的标记前面带名字（「Jean · 第 2 胡」），自己的仍只有「第 N 胡」
  it("只给 won 的家，文字是 winOrder + 1", () => {
    const s = stateWith(
      [{ won: true, winOrder: 1 }, { won: false, winOrder: null }, { won: true, winOrder: 2 }],
      { won: true, winOrder: 0 },
    );
    expect(winMarkers(s)).toEqual([
      { seat: s.me.seat, label: "第 1 胡" },
      { seat: s.others[0].seat, label: `${AI_NAMES[s.others[0].seat]} · 第 2 胡` },
      { seat: s.others[2].seat, label: `${AI_NAMES[s.others[2].seat]} · 第 3 胡` },
    ]);
  });

  it("没人胡：没有标记", () => {
    expect(winMarkers(stateWith([{ won: false, winOrder: null }, { won: false, winOrder: null }, { won: false, winOrder: null }], { won: false, winOrder: null }))).toEqual([]);
  });
});

describe("锁住散牌区", () => {
  const envOf = (state: State): Envelope => ({ matchId: "m-lock", events: [], state, pending: null, result: null, matchFinished: false });

  function setup() {
    const view = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    const state = stateWith([]);
    state.me.hand = ["c", "1", "d"];
    state.me.groups = [];
    view.apply(envOf(state));
    const thingOf = (tile: string) => {
      const i = view.looseSlots.findIndex((e) => e?.tile === tile);
      const p = view.slots.get(`loose.${i}@0`)!.place(0).position;
      return view.pickables.find((t) => t.place.position.equals(p))!.id;
    };
    return { view, c: thingOf("c"), wild: thingOf("1") };
  }

  it("锁住后：拾取候选为空、拖不起来、右键打不了、白搭赋值被拒；解锁后恢复", () => {
    const { view, c, wild } = setup();
    const at = () => view.slots.get(`loose.0@0`)!.place(0).position.clone();

    view.setLocked(true);
    expect(view.pickables).toEqual([]);
    expect(view.setHovered(c)).toBe(false);
    expect(view.hoveredThing).toBeNull();
    expect(view.dragStart(at())).toBe(false);
    expect(view.discardIntentOf(c)).toBeNull();
    expect(view.declareWildAt(wild, "a")).toBe(false);
    expect(view.wildPickerAt(wild)).toBeNull();
    expect(view.setSelected([c])).toBe(false);

    view.setLocked(false);
    expect(view.pickables.length).toBe(3);
    view.setHovered(c);
    expect(view.dragStart(at())).toBe(true);
    view.cancelDrag();
    expect(view.discardIntentOf(c)).toMatchObject({ tile: "c" });
    expect(view.declareWildAt(wild, "a")).toBe(true);
  });

  it("锁住时手上的牌放回原位、选中清空", () => {
    const { view, c } = setup();
    view.setSelected([c]);
    view.setHovered(c);
    view.dragStart(view.slots.get(`loose.0@0`)!.place(0).position.clone());
    expect(view.dragging).toBe(true);
    view.setLocked(true);
    expect(view.dragging).toBe(false);
    expect(view.selectedTileIds()).toEqual([]);
  });
});
