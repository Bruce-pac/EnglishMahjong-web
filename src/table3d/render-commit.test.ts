/**
 * T1.4 方案 §7 不变式 2：**增量 ≡ 全量重绘**。
 *
 * 这条要测在**渲染提交层**，不是测在 `assignThings` 上。`assignThings` 只挑 Thing
 * index、不碰 typeIndex / slotName，拿它的输出去比 `layout()` 的输出是由构造即成立的
 * 恒真式，测不出东西。
 *
 * 有意义的比较是：同一批 `Placement[]`，走快路径 `updateTypes()` 之后的状态，
 * 与走 `replace()` 全量重建之后的状态，**逐项相同**。比较对象是 instance 的
 * `offset` 属性数组和独立 mesh 的 uv 数组。
 *
 * 不需要 GL 上下文：three.js 的 BufferGeometry / InstancedBufferAttribute 都是纯 JS，
 * 只要不 `new WebGLRenderer()` 就能在 vitest 的 node 环境里跑。
 */

import { Group } from "three";
import { describe, expect, it } from "vitest";
import { FACE_COUNT } from "./atlas";
import { fakeAssetLoader } from "./fake-assets";
import { layout } from "./placement";
import { rebuildLoose, reconcileLoose } from "./loose-reconcile";
import { fixtureGames, rng } from "./test-helpers";
import { TileThingGroup, type ThingParams } from "./thing-group";
import { ThingType } from "./types";

function params(types: number[]): ThingParams[] {
  return types.map((typeIndex, index) => ({ type: ThingType.TILE, typeIndex, index }));
}

function build(types: number[]): TileThingGroup {
  const g = new TileThingGroup(fakeAssetLoader(), new Group());
  g.replace(0, params(types));
  return g;
}

/** 把一个组的全部可观察渲染状态抓成快照 */
function snapshot(g: TileThingGroup, n: number) {
  const attr = g.offsetAttribute!;
  return {
    offsets: Array.from(attr.array as Float32Array),
    uvs: Array.from({ length: n }, (_, i) => Array.from(g.meshUv(i)!)),
    types: Array.from(g.committedTypeIndexes),
  };
}

describe("不变式 2：增量 ≡ 全量重绘", () => {
  it("换几张牌的牌面，快路径与重建逐项相同", () => {
    const before = [0, 1, 2, 3, 4, 5];
    const after = [0, 27, 2, 52, 4, 64]; // 换成小写 b、未声明元音白搭、声明为 c 的辅音白搭

    const fast = build(before);
    // needsUpdate 在 three.js 里是只写属性（读回来是 undefined），
    // 能观察到的是它把 version 加了一。数组改了却没置 needsUpdate 的话
    // GPU 那边永远看不到，而只比较数组是查不出来的
    const versionBefore = fast.offsetAttribute!.version;
    fast.updateTypes(params(after));

    const full = build(after);

    expect(snapshot(fast, after.length)).toEqual(snapshot(full, after.length));
    expect(fast.offsetAttribute!.version).toBeGreaterThan(versionBefore);
  });

  it("整批切大小写（§4.9 影响十几张牌）也一致", () => {
    const upper = [...Array(14).keys()];
    const lower = upper.map((i) => i + 26);

    const fast = build(upper);
    fast.updateTypes(params(lower));

    expect(snapshot(fast, lower.length)).toEqual(snapshot(build(lower), lower.length));
  });

  it("一张都没变时快路径是空操作", () => {
    const types = [3, 9, 27, 52, 53];
    const fast = build(types);
    const uvBefore = Array.from(fast.meshUv(0)!);
    fast.updateTypes(params(types));
    // 没变的牌不该被重建（uv 数组是同一份内容）
    expect(Array.from(fast.meshUv(0)!)).toEqual(uvBefore);
    expect(snapshot(fast, types.length)).toEqual(snapshot(build(types), types.length));
  });

  it("随机跑一百轮，快路径始终等价于重建", () => {
    const rand = rng(4242);
    const n = 20;
    let types = Array.from({ length: n }, () => Math.floor(rand() * FACE_COUNT));
    const fast = build(types);

    for (let round = 0; round < 100; round++) {
      types = types.map((t) => (rand() < 0.3 ? Math.floor(rand() * FACE_COUNT) : t));
      fast.updateTypes(params(types));
      expect(snapshot(fast, n), `第 ${round} 轮`).toEqual(snapshot(build(types), n));
    }
  });

  it("形状变了就不走快路径——canUpdateTypes 要挡住", () => {
    const g = build([0, 1, 2]);
    expect(g.canUpdateTypes(0, params([0, 1, 2]))).toBe(true);
    expect(g.canUpdateTypes(0, params([0, 1]))).toBe(false); // 张数变了
    expect(g.canUpdateTypes(5, params([0, 1, 2]))).toBe(false); // 起始下标变了
    // index 不连续
    expect(
      g.canUpdateTypes(0, [
        { type: ThingType.TILE, typeIndex: 0, index: 0 },
        { type: ThingType.TILE, typeIndex: 1, index: 2 },
        { type: ThingType.TILE, typeIndex: 2, index: 3 },
      ]),
    ).toBe(false);
  });

  it("侧面的 uv 永远不被偏移——偏移了牌边会扫过图集里别的字母", () => {
    const g = build([0]);
    const before = Array.from(g.meshUv(0)!);
    g.updateTypes(params([99]));
    const after = Array.from(g.meshUv(0)!);
    // 假几何体里第 7、8、9 个顶点（下标 12..17）是侧面区，必须原样
    expect(after.slice(12)).toEqual(before.slice(12));
    // 正面区确实变了
    expect(after.slice(0, 6)).not.toEqual(before.slice(0, 6));
  });
});

describe("拿真 fixture 的牌面序列跑一遍", () => {
  it("整局每一步的 typeIndex 都能走快路径且与重建一致", () => {
    const game = fixtureGames()[0];
    let r = rebuildLoose(game.steps[0].state.me, 1);

    // 只取自己散牌区那一段——张数会变，正好考验 canUpdateTypes 的回退
    let group: TileThingGroup | null = null;
    let lastLen = -1;

    for (let i = 0; i < game.steps.length; i++) {
      const state = game.steps[i].state;
      if (i > 0) r = reconcileLoose(state.me, r.slots, r.nextTileId);
      const types = layout(state, r.slots, { lowercase: i % 2 === 0 })
        .filter((p) => p.slotName.startsWith("loose."))
        .map((p) => p.typeIndex);
      if (types.length === 0) continue;

      if (!group || types.length !== lastLen) {
        group = build(types);
        lastLen = types.length;
        continue;
      }
      group.updateTypes(params(types));
      expect(snapshot(group, types.length), `第 ${i} 步`).toEqual(
        snapshot(build(types), types.length),
      );
    }
  });
});
