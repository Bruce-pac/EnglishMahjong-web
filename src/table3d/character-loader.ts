/**
 * T2.3c：三个 AI 角色模型的加载器（`web/img/characters.glb`，由 `art/build_characters.py` 生成）。
 *
 * - **懒加载**：只在第一次调用时才发请求。T2.3d 会在第一次切到透视时调——正交模式的玩家一个字节都不该多下。
 *   glb 的 URL 用静态 `?url` 导入：那只是一个字符串，Vite 不会预加载资源 URL，真正的请求在 `loadAsync` 才发。
 *   **不要改成动态 `import()`**：懒加载的 3D chunk 里一出现动态 import，就要去主包借预加载辅助函数，
 *   主包因此多导出一个绑定、变大（T2.3d 实测 205.00 → 205.01 kB，同 `names.ts` 文件头那条）
 * - **Draco 解码器走本站**（`public/draco/`，见那里的 README）。`DRACOLoader` 的默认路径是 Google 的 CDN，
 *   运行时零外部依赖，所以必须显式设成本地
 * - 材质照 `asset-loader.ts` 降级成 Lambert、只留 `map`
 * - **本卡不把它们加进场景**：摆到哪、多大、怎么动是 T2.3d
 */

import { Box3, LinearSRGBColorSpace, Mesh, MeshLambertMaterial, SRGBColorSpace, Vector3 } from "three";
import type { Material, MeshStandardMaterial, Object3D } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import url from "../../img/characters.glb?url";

/** 有角色的三个座位（0 是自己，不画） */
export const CHARACTER_SEATS = [1, 2, 3] as const;
export type CharacterSeat = (typeof CHARACTER_SEATS)[number];
export type Characters = Record<CharacterSeat, Object3D>;

/** 包围盒底部离 y=0 多远还算「站在地上」（模型单位，身高约 1.02） */
const FLOOR_TOLERANCE = 0.02;
/** 三人身高彼此最多差多少（相对值）。原始模型三人一样高，减面不该改变身高 */
const HEIGHT_TOLERANCE = 0.05;

let pending: Promise<Characters> | null = null;

/** 加载三个角色。第一次调用才发请求，之后复用同一个 Promise；失败了允许重试 */
export function loadCharacters(): Promise<Characters> {
  if (!pending) {
    pending = load();
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

async function load(): Promise<Characters> {
  const draco = new DRACOLoader();
  draco.setDecoderPath(import.meta.env.BASE_URL + "draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  try {
    const gltf = await loader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    const out = {} as Characters;
    for (const seat of CHARACTER_SEATS) {
      const obj = gltf.scene.getObjectByName(`seat${seat}`);
      if (!obj) throw new Error(`characters.glb 里没有 seat${seat}——art/build_characters.py 的命名变了？`);
      obj.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(lambert) : lambert(mesh.material);
      });
      out[seat] = obj;
    }
    checkCharacters(out);
    return out;
  } finally {
    // 解码 worker 用完就收掉；三个模型一次解完，之后不再需要它
    draco.dispose();
  }
}

/**
 * 降级成 Lambert、只留 `map`（同 `asset-loader.ts` 的理由：配手调的灯够用，省掉 PBR 着色器）。
 * 角色贴图是照片级的颜色图，按 sRGB 解释才对（牌的图集是平涂色，那边用线性，别照抄）
 */
function lambert(material: Material): Material {
  const map = (material as MeshStandardMaterial).map;
  if (map && map.colorSpace === LinearSRGBColorSpace) map.colorSpace = SRGBColorSpace;
  material.dispose();
  return new MeshLambertMaterial({ map });
}

/**
 * 加载后当场校验（照 `asset-loader.ts` 的 `checkOrientation`，不对就抛错）：
 * 三个都在、脚底在 y≈0（原点在脚底，T2.3d 摆放时直接放在地上）、身高彼此差不超过 5%。
 * **不做任何旋转或平移**——朝向和原点在原始模型里就对了
 */
export function checkCharacters(chars: Characters): void {
  const heights: number[] = [];
  for (const seat of CHARACTER_SEATS) {
    const obj = chars[seat];
    if (!obj) throw new Error(`缺少 seat${seat} 的角色`);
    const box = new Box3().setFromObject(obj);
    if (Math.abs(box.min.y) > FLOOR_TOLERANCE) {
      throw new Error(`seat${seat} 的包围盒底部在 y=${box.min.y.toFixed(3)}，不在地上——原点约定变了？`);
    }
    heights.push(box.getSize(new Vector3()).y);
  }
  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  if (lo <= 0 || (hi - lo) / hi > HEIGHT_TOLERANCE) {
    throw new Error(`三个角色身高差太多：${heights.map((h) => h.toFixed(3)).join(" / ")}`);
  }
}
