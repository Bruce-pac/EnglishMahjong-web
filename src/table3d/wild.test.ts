/** T4.4：白搭赋值（TableView 层） */

import { Group } from "three";
import { describe, expect, it, vi } from "vitest";
import type { Envelope, State } from "../api";
import { WILD_CANDIDATES } from "./atlas";
import { fakeAssetLoader } from "./fake-assets";
import { ObjectView } from "./object-view";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";

function stateWith(hand: string[], groups: { tiles: string; word: string }[] = []): State {
  const state = structuredClone(fixtureGames()[0].steps[2].state);
  state.me.hand = hand;
  state.me.groups = groups;
  return state;
}
const envOf = (state: State): Envelope => ({ matchId: "m-wild", events: [], state, pending: null, result: null, matchFinished: false });

function setup(hand: string[], groups: { tiles: string; word: string }[] = []) {
  const objectView = new ObjectView(new Group(), fakeAssetLoader());
  const view = new TableView(objectView, makeSlots());
  view.apply(envOf(stateWith(hand, groups)));
  /** 散牌区第 k 张某牌面对应的 Thing 编号 */
  const thingOf = (tile: string, k = 0) => {
    const i = view.looseSlots.flatMap((e, j) => (e?.tile === tile ? [j] : []))[k];
    const p = view.slots.get(`loose.${i}@0`)!.place(0).position;
    return view.pickables.find((t) => t.place.position.equals(p))!.id;
  };
  return { view, objectView, thingOf };
}

describe("白搭赋值", () => {
  it("候选表按种类给：元音白搭 5 个，辅音白搭 21 个", () => {
    expect(WILD_CANDIDATES["1"]).toBe("aeiou");
    expect(WILD_CANDIDATES["2"]).toHaveLength(21);
    expect(WILD_CANDIDATES["2"]).not.toMatch(/[aeiou]/);
  });

  it("双击赋值走快路径 updateTypes，不整组重建；牌面换成声明的字母", () => {
    const { view, objectView, thingOf } = setup(["c", "1", "d"]);
    const updateTypes = vi.spyOn(objectView.tiles, "updateTypes");
    const replace = vi.spyOn(objectView.tiles, "replace");
    expect(view.declareWildAt(thingOf("1"), "o")).toBe(true);
    expect(updateTypes).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(view.looseSlots.find((e) => e?.tile === "1")!.wildLetter).toBe("o");
  });

  it("之后随时可以改；字母不在本类候选里、普通字母牌都拒绝", () => {
    const { view, thingOf } = setup(["c", "1", "d", "2"]);
    view.declareWildAt(thingOf("1"), "o");
    expect(view.declareWildAt(thingOf("1"), "a")).toBe(true);
    expect(view.looseSlots.find((e) => e?.tile === "1")!.wildLetter).toBe("a");
    expect(view.declareWildAt(thingOf("1"), "b")).toBe(false); // 元音白搭不能当 B
    expect(view.declareWildAt(thingOf("2"), "e")).toBe(false); // 辅音白搭不能当 E
    expect(view.declareWildAt(thingOf("c"), "a")).toBe(false); // 普通字母牌
    expect(view.wildPickerAt(thingOf("c"))).toBeNull();
    expect(view.wildPickerAt(thingOf("2"))).toMatchObject({ kind: "2" });
  });

  it("暗词里的白搭：配对时反推出字母，双击被忽略", () => {
    const { view, thingOf } = setup(["1", "c", "d", "x"], [{ tiles: "1cd", word: "cod" }]);
    const wild = () => view.looseSlots.find((e) => e?.tile === "1")!;
    expect(wild().wildLetter).toBe("o");
    expect(view.wildPickerAt(thingOf("1"))).toBeNull();
    expect(view.declareWildAt(thingOf("1"), "a")).toBe(false);
    expect(wild().wildLetter).toBe("o");
  });

  it("重复白搭：两张元音白搭定为 A、E，打掉 E 那张，剩下那张仍是 A 且留在原格", () => {
    const { view, thingOf } = setup(["1", "1", "c", "d"]);
    view.declareWildAt(thingOf("1", 0), "a");
    view.declareWildAt(thingOf("1", 1), "e");
    const wilds = view.looseSlots.flatMap((e, i) => (e?.tile === "1" ? [{ i, id: e.tileId, letter: e.wildLetter }] : []));
    const a = wilds.find((w) => w.letter === "a")!;
    const e = wilds.find((w) => w.letter === "e")!;
    // 服务端只知道少了一张 "1"；前端带着打出那张的 tileId 对账
    view.apply(envOf(stateWith(["1", "c", "d"])), [e.id]);
    expect(view.looseSlots[e.i]).toBeNull();
    expect(view.looseSlots[a.i]).toMatchObject({ tileId: a.id, wildLetter: "a" });
  });
});
