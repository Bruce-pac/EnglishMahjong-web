/**
 * 测试用的假 AssetLoader。
 *
 * `TileThingGroup` 只用到 `meshes.tile` 和 `textures.tiles`，两样都不需要 GL 上下文——
 * three.js 的 `BufferGeometry` / `Texture` 都是纯 JS，只要不 `new WebGLRenderer()`
 * 就能在 vitest 的 node 环境里跑（T1.4 方案 §7 不变式 2）。
 *
 * 几何体按真模型的 UV 分区造：正面落在左上角第 0 格、牌背落在第 10 行、侧面在中间带。
 * 三个区都要有，`createMesh()` 的区判定才真的被走到。
 */

import { BufferAttribute, BufferGeometry, Mesh, MeshLambertMaterial, Texture } from "three";
import type { AssetLoader } from "./asset-loader";
import { BACK_ROW, TILE_DU, TILE_DV } from "./atlas";

/** 三个区各造两个三角形，uv 取在区内的代表点上 */
function tileGeometry(): BufferGeometry {
  const uv: number[] = [];
  const push = (u: number, v: number) => uv.push(u, v);

  // 正面：u <= DU && v <= DV
  push(0, 0);
  push(TILE_DU, 0);
  push(TILE_DU, TILE_DV);
  // 牌背：v >= 10*DV
  push(0, BACK_ROW * TILE_DV);
  push(TILE_DU, BACK_ROW * TILE_DV);
  push(TILE_DU, BACK_ROW * TILE_DV + TILE_DV);
  // 侧面：两个都不满足，永远不该被偏移
  push(0.5, BACK_ROW * TILE_DV - TILE_DV / 2);
  push(0.5, BACK_ROW * TILE_DV - TILE_DV / 2);
  push(0.5, BACK_ROW * TILE_DV - TILE_DV / 2);

  const n = uv.length / 2;
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  return g;
}

export function fakeAssetLoader(): AssetLoader {
  const texture = new Texture();
  const mesh = new Mesh(tileGeometry(), new MeshLambertMaterial({ map: texture }));
  mesh.name = "tile";
  return {
    textures: { tiles: texture },
    meshes: { tile: mesh },
    make: () => {
      const m = mesh.clone();
      m.geometry = mesh.geometry.clone();
      m.material = (mesh.material as MeshLambertMaterial).clone();
      return m;
    },
  } as unknown as AssetLoader;
}
