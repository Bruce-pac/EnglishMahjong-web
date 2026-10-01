/** T6.3：同一场换局时重置散牌区身份 */

import { Group } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope, Result, State } from "../api";
import { fakeAssetLoader } from "./fake-assets";
import { ObjectView } from "./object-view";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";

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

function stateOf(hand: string[], groups: { tiles: string; word: string }[], gamesPlayed: number): State {
  const st = structuredClone(fixtureGames()[0].steps[2].state);
  st.me.hand = hand;
  st.me.groups = groups;
  st.gamesPlayed = gamesPlayed;
  return st;
}
const env = (st: State): Envelope => ({ matchId: "m-next", events: [], state: st, pending: null, result: null, matchFinished: false });
const newView = () => new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());

/** 上一局：白搭声明成 O、组了暗词 CAT */
function playGame0(view: TableView) {
  view.apply(env(stateOf(["1", "d", "c", "a", "t"], [{ tiles: "act", word: "cat" }], 0)));
  const wild = view.looseSlots.find((e) => e?.tile === "1")!;
  const thing = view.pickables.find((t) => view.slotNames.get(t.id) === `loose.${view.looseSlots.indexOf(wild)}@0`)!.id;
  expect(view.declareWildAt(thing, "o")).toBe(true);
  expect(view.looseSlots.some((e) => e?.groupKey)).toBe(true);
  return Math.max(...view.looseSlots.flatMap((e) => (e ? [e.tileId] : [])));
}
// 新一局：手牌里恰好也有白搭和 C A T，最容易把上一局的声明和 key 误带过来
const game1 = () => env(stateOf(["1", "c", "a", "t", "x"], [], 1));

describe("换局重置", () => {
  it("同一 matchId 下 gamesPlayed 从 0 变 1：散牌区从零铺开，白搭声明和 groupKey 不带过来，tileId 继续递增", () => {
    const view = newView();
    const maxId = playGame0(view);
    view.apply(game1());
    const s = view.looseSlots;
    expect(s.filter(Boolean).every((e) => e!.wildLetter === undefined && e!.groupKey === undefined)).toBe(true);
    expect(Math.min(...s.flatMap((e) => (e ? [e.tileId] : [])))).toBeGreaterThan(maxId);
    // 从零铺开 = 居中按手牌顺序铺，而不是在上一局的格子里对账
    expect(s.map((e) => e?.tile ?? ".").join("").replace(/\./g, "")).toBe("1catx");
  });

  it("显式 resetGame 之后再 apply，结果一样", () => {
    const view = newView();
    const maxId = playGame0(view);
    view.resetGame();
    view.apply(game1());
    expect(view.looseSlots.filter(Boolean).every((e) => !e!.wildLetter && !e!.groupKey)).toBe(true);
    expect(Math.min(...view.looseSlots.flatMap((e) => (e ? [e.tileId] : [])))).toBeGreaterThan(maxId);
  });

  it("刷新后读到上一局的存档（别的标签页开了下一局）：不用它的散牌区，但接着用它的 nextTileId", () => {
    const maxId = playGame0(newView());
    const fresh = newView(); // 刷新 = 新的 TableView 读存档
    fresh.apply(game1());
    expect(fresh.looseSlots.filter(Boolean).every((e) => !e!.wildLetter && !e!.groupKey)).toBe(true);
    expect(Math.min(...fresh.looseSlots.flatMap((e) => (e ? [e.tileId] : [])))).toBeGreaterThan(maxId);
  });

  it("同一局刷新：存档照常沿用（顺序、白搭声明都在）", () => {
    const view = newView();
    playGame0(view);
    const before = view.looseSlots.map((e) => e && { id: e.tileId, w: e.wildLetter });
    const fresh = newView();
    fresh.apply(env(stateOf(["1", "d", "c", "a", "t"], [{ tiles: "act", word: "cat" }], 0)));
    expect(fresh.looseSlots.map((e) => e && { id: e.tileId, w: e.wildLetter })).toEqual(before);
  });

  it("按服务端真实的节奏：结算那一刻（gamesPlayed 已加 1、带 result）不算换局，下一局开出来才算", () => {
    const view = newView();
    const maxId = playGame0(view);
    const declared = view.looseSlots.find((e) => e?.tile === "1")!;
    const declaredSlot = view.looseSlots.indexOf(declared); // 结算前白搭所在的格子
    // 第 1 局结算：胡的那张 T 加进手牌，gamesPlayed 变 1，带 result
    const result: Result = { rows: [], exhausted: false, myWords: [], missed: [], leftover: [], listWords: [] };
    const settled: Envelope = { ...env(stateOf(["1", "d", "c", "a", "t", "t"], [{ tiles: "act", word: "cat" }], 1)), result };
    view.apply(settled);
    // 同一张白搭（同一个 tileId）还在结算前那一格：没有被当成换局清空重铺
    expect(view.looseSlots.findIndex((e) => e?.tileId === declared.tileId)).toBe(declaredSlot);
    expect(view.looseSlots[declaredSlot]?.wildLetter).toBe("o"); // 白搭声明也还在
    // 第 2 局开出来：gamesPlayed 仍是 1，result 为空 → 这才是换局
    view.apply(game1());
    expect(view.looseSlots.filter(Boolean).every((e) => !e!.wildLetter && !e!.groupKey)).toBe(true);
    expect(Math.min(...view.looseSlots.flatMap((e) => (e ? [e.tileId] : [])))).toBeGreaterThan(maxId);
  });
});

