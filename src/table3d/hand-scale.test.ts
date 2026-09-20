/**
 * P6：自己那排散牌放大 + 后仰。这里测的是**渲染真的照 `place.scale` 画了**，
 * 以及**飞出手牌时缩放是一路变过去的**——这两条审查时变异存活，补上。
 */

import { Group, Matrix4, Quaternion, Vector3, type InstancedMesh } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope, State } from "../api";
import { fakeAssetLoader } from "./fake-assets";
import { ObjectView } from "./object-view";
import { HAND_SCALE, makeSlots } from "./setup-slots";
import { TableView, TWEEN_TIME } from "./table-view";
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

/** 实例矩阵里每张牌的缩放（隐藏起来的实例矩阵是零矩阵，跳过） */
function scales(objectView: ObjectView): number[] {
  // 牌的实例网格：带每实例的 offset 属性（影子那个也是 InstancedMesh，别挑错）
  const im = objectView.mainGroup.children.find(
    (c) => (c as InstancedMesh).isInstancedMesh && (c as InstancedMesh).geometry.getAttribute("offset") !== undefined,
  ) as InstancedMesh;
  const m = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3();
  const out: number[] = [];
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m);
    m.decompose(p, q, s);
    if (s.x > 0.001) out.push(Number(s.x.toFixed(5)));
  }
  return out;
}

function stateWith(hand: string[], discards: string[] = []): State {
  const st = structuredClone(fixtureGames()[0].steps[2].state);
  st.me.hand = [...hand];
  st.me.groups = [];
  st.discards = [...discards];
  st.discardSeats = discards.map(() => 0);
  return st;
}
const env = (state: State): Envelope => ({
  matchId: "m-scale", events: [], state, pending: null, result: null, matchFinished: false,
});

describe("P6 渲染缩放", () => {
  function setup() {
    const objectView = new ObjectView(new Group(), fakeAssetLoader());
    const view = new TableView(objectView, makeSlots());
    return { view, objectView };
  }

  it("自己手牌按 HAND_SCALE 画，别处的牌画 1 倍", () => {
    const { view, objectView } = setup();
    view.apply(env(stateWith(["c", "a", "t"], ["x", "y"])));
    const got = scales(objectView);
    const mine = got.filter((s) => Math.abs(s - HAND_SCALE) < 1e-4).length;
    const others = got.filter((s) => Math.abs(s - 1) < 1e-4).length;
    expect(mine).toBe(3); // 自己散牌区那 3 张
    expect(others).toBeGreaterThan(0); // 牌河、牌墙、别家
    expect(got.every((s) => Math.abs(s - 1) < 1e-4 || Math.abs(s - HAND_SCALE) < 1e-4)).toBe(true);
  });

  it("牌飞出手牌时缩放一路变过去：补间中途有牌的缩放卡在两者之间", () => {
    const { view, objectView } = setup();
    view.apply(env(stateWith(["c", "a", "t"])));
    const t0 = performance.now();
    view.apply(env(stateWith(["c", "a"], ["t"])));
    view.update(t0 + TWEEN_TIME / 2);
    const mid = scales(objectView).filter((s) => s > 1 + 1e-3 && s < HAND_SCALE - 1e-3);
    expect(mid.length).toBeGreaterThan(0);
  });
});
