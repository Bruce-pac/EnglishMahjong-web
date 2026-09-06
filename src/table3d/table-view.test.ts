/**
 * T2.1：envelope → 场景这条线。
 *
 * 不需要 GL 上下文——`TableView` 只跟 `ObjectView` 说话，而 `ObjectView` 那套
 * （InstancedMesh / BufferGeometry）都是纯 JS，只要不 `new WebGLRenderer()`
 * 就能在 vitest 的 node 环境里跑（T1.4 方案 §7 的既有结论）。
 *
 * 这里守的是三件在浏览器里**看不出根因**的事：
 * 1. `layout()` 给的槽位名，`makeSlots()` 里真的有——对不上只会是一桌空牌
 * 2. `rotationIndex` 没越界——越界让 `places[i]` 取到 undefined，坐标变 NaN
 * 3. 分配是双射，且实例池够用（零余量的 108）
 */

import { Group } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope, State } from "../api";
import { fakeAssetLoader } from "./fake-assets";
import { TILE_COUNT } from "./layout";
import { ObjectView } from "./object-view";
import { layout } from "./placement";
import { rebuildLoose } from "./loose-reconcile";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";

const slots = makeSlots();

function envelopeOf(state: State, matchId = "m1"): Envelope {
  return { matchId, events: [], state, pending: null, result: null, matchFinished: false };
}

function newView(): TableView {
  return new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
}

/** vitest 跑在 node 环境，没有 window/localStorage——造一个最小实现给存档用 */
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
afterEach(() => vi.unstubAllGlobals());

describe("layout() 的槽位名与 makeSlots() 对得上", () => {
  it("整局每一步的每个 Placement 都能找到槽位，且 rotationIndex 不越界", () => {
    for (const game of fixtureGames()) {
      for (const step of game.steps) {
        const r = rebuildLoose(step.state.me, 1);
        for (const p of layout(step.state, r.slots, { lowercase: false })) {
          const slot = slots.get(p.slotName);
          expect(slot, p.slotName).toBeDefined();
          expect(p.rotationIndex, `${p.slotName} 的朝向下标`).toBeLessThan(
            slot!.rotations.length,
          );
          const place = slot!.places[p.rotationIndex];
          expect(Number.isFinite(place.position.x) && Number.isFinite(place.position.y)).toBe(
            true,
          );
        }
      }
    }
  });

  it("牌墙的 rotationIndex 恒为 0——写成 1 会取到 undefined，坐标变 NaN", () => {
    const state = fixtureGames()[0].steps[0].state;
    const r = rebuildLoose(state.me, 1);
    const wall = layout(state, r.slots, { lowercase: false }).filter((p) =>
      p.slotName.startsWith("wall."),
    );
    expect(wall.length).toBeGreaterThan(0);
    for (const p of wall) expect(p.rotationIndex).toBe(0);
  });
});

describe("TableView 把整局画下来", () => {
  it("每一步都是双射：一个槽位一个实例，一个实例至多一处", () => {
    for (const game of fixtureGames()) {
      const view = newView();
      for (const step of game.steps) {
        view.apply(envelopeOf(step.state, game.name));
        const names = [...view.slotNames.values()];
        expect(new Set(names).size, "同一个槽位被摆了两张牌").toBe(names.length);
        expect(new Set(view.slotNames.keys()).size).toBe(names.length);

        const want = layout(step.state, view.looseSlots, { lowercase: false });
        expect(names.length).toBe(want.length);
        expect(want.length).toBeLessThanOrEqual(TILE_COUNT);
      }
    }
  });

  it("局面没变时实例原地不动——三轮匹配的轮 ① 真的在干活", () => {
    const state = fixtureGames()[0].steps[0].state;
    const view = newView();
    view.apply(envelopeOf(state));
    const first = new Map(view.slotNames);
    view.apply(envelopeOf(state));
    expect(new Map(view.slotNames)).toEqual(first);
  });

  it("牌河按 discardSeats 分四片，不是堆在一片", () => {
    // fixture 里找一步四家都打过牌的
    const step = fixtureGames()
      .flatMap((g) => g.steps)
      .find((s) => new Set(s.state.discardSeats).size === 4);
    expect(step, "fixture 里没有四家都打过牌的局面").toBeDefined();

    const view = newView();
    view.apply(envelopeOf(step!.state));
    const seats = new Set(
      [...view.slotNames.values()]
        .filter((n) => n.startsWith("discard."))
        .map((n) => n.slice(n.indexOf("@"))),
    );
    expect(seats).toEqual(new Set(["@0", "@1", "@2", "@3"]));
  });

  it("刷新等价：存档 → 重建之后，散牌区逐格相同", () => {
    const steps = fixtureGames()[0].steps;
    const view = newView();
    for (const step of steps) view.apply(envelopeOf(step.state));
    const before = view.looseSlots;

    // 新开一个 TableView（= 刷新页面），同一个 matchId，从 localStorage 捞
    const after = newView();
    after.apply(envelopeOf(steps[steps.length - 1].state));
    expect(after.looseSlots).toEqual(before);
  });
});
