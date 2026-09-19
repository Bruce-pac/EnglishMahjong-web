/** P8：暗词框的两个描边通道怎么分 */

import { describe, expect, it } from "vitest";
import { LOOSE_SLOTS } from "./layout";
import { assignGroupPasses } from "./group-pass";
import type { LooseSlots } from "./loose-reconcile";

/** 用字符串摆散牌区：大写字母后跟数字 = 属于那个 groupId 的暗词，小写 = 散牌，`_` = 空格子 */
function slots(spec: string[]): LooseSlots {
  const s: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
  spec.forEach((c, i) => {
    if (c === "_") return;
    const gid = c.length > 1 ? Number(c.slice(1)) : undefined;
    s[i] = { tileId: i + 1, tile: c[0].toLowerCase(), ...(gid !== undefined ? { groupId: gid } : {}) };
  });
  return s;
}

describe("assignGroupPasses", () => {
  it("两个紧挨着的暗词分到不同通道", () => {
    const p = assignGroupPasses(slots(["_", "_", "C1", "A1", "T1", "D2", "O2", "G2", "_", "b"]));
    expect(p.get(1)).toBe(0);
    expect(p.get(2)).toBe(1);
  });

  it("三个连着的暗词 0/1/0，按最左一张的格子排而不是按 groupId", () => {
    const p = assignGroupPasses(slots(["B7", "E7", "C3", "A3", "T3", "D5", "O5", "G5"]));
    expect([p.get(7), p.get(3), p.get(5)]).toEqual([0, 1, 0]);
  });

  it("中间隔着散牌的两个暗词也照样交替", () => {
    const p = assignGroupPasses(slots(["C1", "A1", "T1", "s", "_", "D2", "O2", "G2"]));
    expect([p.get(1), p.get(2)]).toEqual([0, 1]);
  });

  it("没有暗词：空表", () => {
    expect(assignGroupPasses(slots(["a", "b", "_", "c"])).size).toBe(0);
  });
});

describe("TableView → ObjectView 的两个暗词列表", () => {
  it("CAT、DOG 两个暗词各进一个通道", async () => {
    const { Group } = await import("three");
    const { ObjectView } = await import("./object-view");
    const { TableView } = await import("./table-view");
    const { fakeAssetLoader } = await import("./fake-assets");
    const { fixtureGames } = await import("./test-helpers");
    const { makeSlots } = await import("./setup-slots");
    const objectView = new ObjectView(new Group(), fakeAssetLoader());
    const view = new TableView(objectView, makeSlots());
    const state = structuredClone(fixtureGames()[0].steps[2].state);
    state.me.hand = ["c", "a", "t", "d", "o", "g", "x"];
    state.me.groups = [
      { tiles: "act", word: "cat" },
      { tiles: "dgo", word: "dog" },
    ];
    view.apply({ matchId: "m-pass", events: [], state, pending: null, result: null, matchFinished: false });
    expect(objectView.groupedObjects[0]).toHaveLength(3);
    expect(objectView.groupedObjects[1]).toHaveLength(3);
  });
});
