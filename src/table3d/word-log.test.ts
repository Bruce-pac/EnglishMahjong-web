/** P18 本局词条：melds 差集 + 事件补标签 */

import { Group } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope, GameEvent, State } from "../api";
import { fakeAssetLoader } from "./fake-assets";
import { ObjectView } from "./object-view";
import { load } from "./persist";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";
import { parseWordLog, syncWordLog, type WordEntry } from "./word-log";

/** 各家 melds 按座位给：{0: ["cat"], 2: ["dog"]} */
function stateWith(melds: Record<number, string[]>, gamesPlayed = 0): State {
  const st = structuredClone(fixtureGames()[0].steps[2].state);
  const w = (seat: number) => (melds[seat] ?? []).map((word) => ({ tiles: word, word }));
  st.me.melds = w(st.me.seat);
  for (const o of st.others) o.melds = w(o.seat);
  st.gamesPlayed = gamesPlayed;
  return st;
}
const reveal = (seat: number, word: string): GameEvent => ({
  t: "reveal",
  seat,
  word,
  tiles: word,
});
const chi = (seat: number, word: string): GameEvent => ({
  t: "chi",
  seat,
  word,
  tiles: word,
  tile: word[0],
});

describe("syncWordLog", () => {
  it("同一步两家各亮一个词：按座位号排", () => {
    const log = syncWordLog([], stateWith({ 3: ["dog"], 1: ["cat"] }), [reveal(3, "dog"), reveal(1, "cat")]);
    expect(log).toEqual([
      { seat: 1, word: "cat", act: "reveal" },
      { seat: 3, word: "dog", act: "reveal" },
    ]);
  });

  it("已有的词条保持先后，新词接在后面", () => {
    const a = syncWordLog([], stateWith({ 3: ["dog"] }), [reveal(3, "dog")]);
    const b = syncWordLog(a, stateWith({ 3: ["dog"], 0: ["beat"] }), [reveal(0, "beat")]);
    expect(b.map((e) => e.word)).toEqual(["dog", "beat"]);
  });

  it("chi 标「吃」（吃之后紧跟的同词 reveal 不改标签）", () => {
    const log = syncWordLog([], stateWith({ 2: ["orange"] }), [chi(2, "orange"), reveal(2, "orange")]);
    expect(log).toEqual([{ seat: 2, word: "orange", act: "chi" }]);
  });

  it("快进跳过了中间几步：最后一次对齐照样补齐，标签从整个 envelope 的 events 找", () => {
    const events = [reveal(1, "cat"), chi(2, "orange"), reveal(2, "orange"), reveal(3, "dog")];
    // 回放只走了第一步就被快进
    const step = syncWordLog([], stateWith({ 1: ["cat"] }), events);
    const done = syncWordLog(step, stateWith({ 1: ["cat"], 2: ["orange"], 3: ["dog"] }), events);
    expect(done).toEqual([
      { seat: 1, word: "cat", act: "reveal" },
      { seat: 2, word: "orange", act: "chi" },
      { seat: 3, word: "dog", act: "reveal" },
    ]);
  });

  it("读档与 state 不一致：以 state 为准，多的丢、缺的补且不带标签", () => {
    const saved: WordEntry[] = [
      { seat: 3, word: "dog", act: "reveal" },
      { seat: 1, word: "cat", act: "chi" },
      { seat: 1, word: "zzz", act: "reveal" },
    ];
    const log = syncWordLog(saved, stateWith({ 1: ["cat"], 3: ["dog"], 0: ["beat"] }));
    expect(log).toEqual([
      { seat: 3, word: "dog", act: "reveal" },
      { seat: 1, word: "cat", act: "chi" },
      { seat: 0, word: "beat", act: null },
    ]);
  });

  it("某家前面的词对不上，这家之后的也都丢掉重补", () => {
    const saved: WordEntry[] = [
      { seat: 1, word: "cow", act: "reveal" },
      { seat: 1, word: "cat", act: "reveal" },
    ];
    expect(syncWordLog(saved, stateWith({ 1: ["cat"] }))).toEqual([{ seat: 1, word: "cat", act: null }]);
  });

  it("parseWordLog：形状不对返回 undefined", () => {
    expect(parseWordLog([{ seat: 1, word: "cat", act: "chi" }])).toHaveLength(1);
    expect(parseWordLog([{ seat: 1, word: "cat", act: "eat" }])).toBeUndefined();
    expect(parseWordLog("x")).toBeUndefined();
  });
});

describe("TableView 的词条", () => {
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
  const env = (st: State, events: GameEvent[] = []): Envelope => ({
    matchId: "m-log",
    events,
    state: st,
    pending: null,
    result: null,
    matchFinished: false,
  });
  const newView = () => new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());

  it("刷新后从存档恢复，顺序和标签不变", () => {
    const v = newView();
    v.apply(env(stateWith({ 3: ["dog"] }), [reveal(3, "dog")]));
    v.apply(env(stateWith({ 3: ["dog"], 2: ["orange"] }), [chi(2, "orange"), reveal(2, "orange")]));
    expect(load("m-log")?.wordLog).toHaveLength(2);

    const again = newView();
    again.apply(env(stateWith({ 3: ["dog"], 2: ["orange"] })));
    expect(again.wordLog).toEqual([
      { seat: 3, word: "dog", act: "reveal" },
      { seat: 2, word: "orange", act: "chi" },
    ]);
  });

  it("换局清空", () => {
    const v = newView();
    v.apply(env(stateWith({ 3: ["dog"] }), [reveal(3, "dog")]));
    v.resetGame();
    expect(v.wordLog).toEqual([]);
    v.apply(env(stateWith({}, 1)));
    expect(v.wordLog).toEqual([]);
    expect(load("m-log")?.wordLog).toEqual([]);
  });

  it("别的标签页开了下一局再刷新：上一局的词条不带过来", () => {
    const v = newView();
    v.apply(env(stateWith({ 3: ["dog"] }), [reveal(3, "dog")]));
    // 新局里同一座位恰好也亮了同一个词：带过来的话标签会是 reveal
    const again = newView();
    again.apply(env(stateWith({ 3: ["dog"] }, 1)));
    expect(again.wordLog).toEqual([{ seat: 3, word: "dog", act: null }]);
  });
});
