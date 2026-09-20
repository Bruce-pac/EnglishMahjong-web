/** P20：框选之后整批拖动（照 Autotable） */

import { Group, Vector3 } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAssetLoader } from "./fake-assets";
import { moveGroupLoose } from "./loose-reconcile";
import { ObjectView } from "./object-view";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}
beforeEach(() => vi.stubGlobal("window", { localStorage: fakeStorage() }));

/** 手牌 x c a t y（可带暗词），散牌按发牌顺序铺在 loose.0.. */
function setup(groups: { tiles: string; word: string }[] = []) {
  const objectView = new ObjectView(new Group(), fakeAssetLoader());
  const view = new TableView(objectView, makeSlots());
  const state = structuredClone(fixtureGames()[0].steps[2].state);
  state.me.hand = ["x", "c", "a", "t", "y", "z"];
  state.me.groups = groups;
  view.apply({ matchId: "m-multi", events: [], state, pending: null, result: null, matchFinished: false });
  const posOf = (name: string) => view.slots.get(name)!.place(0).position;
  const thingAt = (slot: number) =>
    view.pickables.find((t) => t.place.position.equals(posOf(`loose.${slot}@0`)))!.id;
  const tileIdAt = (slot: number) => view.looseSlots[slot]!.tileId;
  const select = (...slots: number[]) => view.setSelected(slots.map(thingAt));
  const press = (slot: number) => {
    const p = posOf(`loose.${slot}@0`);
    view.setHovered(thingAt(slot));
    return view.dragStart(new Vector3(p.x, p.y, 4));
  };
  const moveTo = (name: string) => {
    const p = posOf(name);
    view.dragMove(new Vector3(p.x, p.y, 4));
  };
  const show = () => view.looseSlots.map((e) => e?.tile ?? ".").join("");
  /** 散牌是居中铺的，格子号按字母找 */
  const at = (tile: string) => view.looseSlots.findIndex((e) => e?.tile === tile);
  return { view, objectView, posOf, thingAt, tileIdAt, select, press, moveTo, show, at };
}

describe("框选后整批拖动", () => {
  it("按住选中的牌之一：三张一起拿起，拖动全程金边还在", () => {
    const t = setup();
    t.select(t.at("c"), t.at("a"), t.at("t"));
    expect(t.press(t.at("a"))).toBe(true);
    expect(t.view.heldTileIds()).toHaveLength(3);
    t.moveTo(`loose.${t.at("c") + 4}@0`);
    t.view.update(performance.now());
    expect(t.view.selectedTileIds()).toHaveLength(3);
    expect(t.objectView.selectedObjects).toHaveLength(3);
  });

  it("落下后选中清空（合法落点）", () => {
    const t = setup();
    t.select(t.at("c"), t.at("a"), t.at("t"));
    t.press(t.at("a"));
    t.moveTo(`loose.${t.at("c") + 5}@0`);
    t.view.dragEnd();
    expect(t.view.selectedTileIds()).toEqual([]);
    // c a t 一起右移 5 格，中间的 y z 被挤到左边让位
    expect(t.show().replace(/\.+$/, "")).toBe("......x..yzcat");
  });

  it("落点非法（越界）滑回之后选中也清空", () => {
    const t = setup();
    t.select(t.at("c"), t.at("a"), t.at("t"));
    const before = t.show();
    t.press(t.at("c"));
    t.moveTo("loose.17@0"); // c 落到最后一格，a、t 就越界了
    t.view.dragEnd();
    expect(t.show()).toBe(before);
    expect(t.view.selectedTileIds()).toEqual([]);
  });

  it("按住没选中的牌：清空选中，只拖那一张", () => {
    const t = setup();
    t.select(t.at("c"), t.at("a"), t.at("t"));
    expect(t.press(t.at("y"))).toBe(true);
    expect(t.view.heldTileIds()).toHaveLength(1);
    expect(t.view.selectedTileIds()).toEqual([]);
  });

  it("选中的牌不连续：相对格距不变，与 moveGroupLoose 一致", () => {
    const t = setup();
    t.select(t.at("c"), t.at("t")); // 中间夹着没选中的 a
    const from = t.at("c");
    const ids = [t.tileIdAt(from), t.tileIdAt(t.at("t"))];
    const expected = moveGroupLoose(t.view.looseSlots, ids, from, from + 4);
    t.press(from);
    t.moveTo(`loose.${from + 4}@0`);
    t.view.dragEnd();
    expect(t.show()).toBe(expected!.map((e) => e?.tile ?? ".").join(""));
  });

  it("多选拖到自己牌河：不打牌，整批滑回，选中清空", () => {
    const t = setup();
    t.select(t.at("c"), t.at("a"), t.at("t"));
    t.press(t.at("a"));
    const before = t.show();
    const river = t.view.slots.get("discard.0.0@0") ?? [...t.view.slots.values()].find((s) => s.group === "discard" && s.seat === 0)!;
    const p = river.place(0).position;
    t.view.dragMove(new Vector3(p.x, p.y, 4));
    expect(t.view.dragEnd()).toBeNull();
    expect(t.show()).toBe(before);
    expect(t.view.selectedTileIds()).toEqual([]);
  });

  it("回放打断拖动（apply）再接回来：选中不掉，还是这几张", () => {
    const t = setup();
    t.select(t.at("c"), t.at("a"), t.at("t"));
    t.press(t.at("a"));
    t.moveTo(`loose.${t.at("c") + 3}@0`);
    // 别家出了张牌：同一局的新 envelope 进来，拖动被打断后 resumeDrag 接回
    const state = structuredClone(fixtureGames()[0].steps[2].state);
    state.me.hand = ["x", "c", "a", "t", "y", "z"];
    state.discards = [...state.discards, "q"];
    state.discardSeats = [...state.discardSeats, 1];
    t.view.apply({ matchId: "m-multi", events: [], state, pending: null, result: null, matchFinished: false });
    expect(t.view.heldTileIds()).toHaveLength(3);
    expect(t.view.selectedTileIds()).toHaveLength(3);
  });

  it("整批拖动会把暗词劈开 → 整批滑回、散牌区不变，选中照样清空（审查补）", () => {
    const t = setup([{ tiles: "act", word: "cat" }]);
    const before = t.show();
    // x 在暗词左边、y 在右边。按住 x 往右挪一格：x 会落进暗词里，把 CAT 劈开
    t.select(t.at("x"), t.at("y"));
    expect(t.press(t.at("x"))).toBe(true);
    t.moveTo(`loose.${t.at("x") + 1}@0`);
    t.view.dragEnd();
    expect(t.show()).toBe(before);
    expect(t.view.selectedTileIds()).toEqual([]);
  });

  it("整批拖动只是把暗词整体挤开 → 合法，暗词不散架（审查补）", () => {
    const t = setup([{ tiles: "act", word: "cat" }]);
    const gid = t.view.looseSlots.find((e) => e?.groupId !== undefined)!.groupId;
    t.select(t.at("y"), t.at("z"));
    expect(t.press(t.at("y"))).toBe(true);
    t.moveTo(`loose.${t.at("y") - 2}@0`);
    t.view.dragEnd();
    // 暗词的三张仍然连在一起、顺序不变
    const gi = t.view.looseSlots.flatMap((e, i) => (e?.groupId === gid ? [i] : []));
    expect(gi).toHaveLength(3);
    expect(gi[2] - gi[0]).toBe(2);
    expect(gi.map((i) => t.view.looseSlots[i]!.tile).join("")).toBe("cat");
    expect(t.view.selectedTileIds()).toEqual([]);
  });

  it("暗词照旧：按住暗词里的牌整组拿起、选中被清空", () => {
    const t = setup([{ tiles: "act", word: "cat" }]);
    t.select(t.at("y"));
    const gi = t.view.looseSlots.findIndex((e) => e?.groupId !== undefined);
    expect(t.press(gi)).toBe(true);
    expect(t.view.heldTileIds()).toHaveLength(3);
    expect(t.view.selectedTileIds()).toEqual([]);
  });
});
