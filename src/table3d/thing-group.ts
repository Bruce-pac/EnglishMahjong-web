import {
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";
import { AssetLoader } from "./asset-loader";
import { BACK_ROW, faceOffset, TILE_DU, TILE_DV } from "./atlas";
import { ThingType } from "./types";

export interface ThingParams {
  type: ThingType;
  typeIndex: number;
  index: number;
}

/** 朝向差多少以内算「没动」。用来给 setSimple 提前返回 */
const ROT_EPS = 0.05;
function rotEquals(a: Quaternion, b: Quaternion): boolean {
  return (
    Math.abs(a.x - b.x) < ROT_EPS &&
    Math.abs(a.y - b.y) < ROT_EPS &&
    Math.abs(a.z - b.z) < ROT_EPS &&
    Math.abs(a.w - b.w) < ROT_EPS
  );
}

/**
 * 一批同类物件的渲染载体，**Simple / Custom 双轨**（研究笔记 §3.3）。
 *
 * 同时持有一个 InstancedMesh 和一组 per-thing 的普通 Mesh：
 * - 静止的牌走 `setSimple()`：写进 `instanceMatrix`，独立 mesh 隐藏 → 全部合成 1 个 draw call
 * - `hovered / selected / held / bottom` 的牌走 `setCustom()`：该实例的矩阵置零矩阵
 *   （从批渲染里抹掉），独立 mesh 显示 → 可以单独改 emissive / opacity / depthTest
 *
 * 两条路互斥，所以任何时刻一张牌只会被画一次。
 */
export class TileThingGroup {
  private assetLoader: AssetLoader;
  private group: Group;
  private startIndex = 0;
  private meshes: Array<Mesh> = [];
  private instancedMesh: InstancedMesh | null = null;
  private readonly zero = new Matrix4().makeScale(0, 0, 0);

  constructor(assetLoader: AssetLoader, group: Group) {
    this.assetLoader = assetLoader;
    this.group = group;
  }

  /**
   * 着色器注入的那一段。**这是图集与模型之间的契约**（需求文档 §7.1）：
   *
   * - `u <= DU && v <= DV` 是正面 → 加 `offset.xy`，挪到 typeIndex 对应的格子
   * - `v >= 10*DV` 是牌背 → 只加 `offset.z`，选深浅变体
   * - 其余（侧面与倒角）两个都不满足 → **原样不动**，采第 9 行的纯色色板
   *
   * 侧面必须落在中间带，否则会跟着 typeIndex 一起偏移、采到别的字母。
   * 模型那边（`art/make_model.py`）按法线把 UV 硬分配到这三个区，两边对齐。
   */
  private uvChunk(): string {
    return `
#include <uv_vertex>
if (vMapUv.x <= ${TILE_DU} && vMapUv.y <= ${TILE_DV}) {
  vMapUv += offset.xy;
} else if (vMapUv.y >= ${BACK_ROW * TILE_DV}) {
  vMapUv.y += offset.z;
}
`;
  }

  private createInstancedMesh(params: Array<ThingParams>): InstancedMesh {
    const origMesh = this.assetLoader.meshes.tile;
    const origMaterial = origMesh.material as MeshLambertMaterial;
    const material = new MeshLambertMaterial({
      // 必须有 map，否则 three.js 不生成 vMapUv，注入的着色器编译不过
      map: this.assetLoader.textures.tiles,
      color: origMaterial.color,
    });

    const uvChunk = this.uvChunk();
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "attribute vec3 offset;\n#include <common>")
        .replace("#include <uv_vertex>", uvChunk);
    };
    // ⚠️ 少了这一行，three.js 会认为「材质参数一样 = 着色器一样」，
    // 把注入过 offset 的着色器和没注入的混着用，牌面会整片错乱。
    material.customProgramCacheKey = () => origMesh.name;

    // Firefox Android 上最后一个 instance 不渲染（Autotable 记录的既有 bug）。
    // 多分配一个、缩放到 0 藏起来，绕过去。
    const extra = 1;

    const data = new Float32Array((params.length + extra) * 3);
    for (let i = 0; i < params.length; i++) {
      const [x, y, z] = faceOffset(params[i].typeIndex);
      data[3 * i] = x;
      data[3 * i + 1] = y;
      data[3 * i + 2] = z;
    }

    const geometry = new BufferGeometry().copy(origMesh.geometry);
    geometry.setAttribute("offset", new InstancedBufferAttribute(data, 3));

    const instancedMesh = new InstancedMesh(geometry, material, params.length + extra);
    // 牌散布在整张桌子上，包围盒算出来意义不大，逐帧剔除反而是开销
    instancedMesh.frustumCulled = false;
    for (let i = 0; i < extra; i++) {
      instancedMesh.setMatrixAt(params.length + i, this.zero);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    return instancedMesh;
  }

  /**
   * 给单张牌造一个独立 Mesh（Custom 轨用）。
   *
   * 独立 Mesh 走不了 instance 属性，所以 UV 偏移得**烘进几何体**：
   * 按同一套区判定把 uv 数组就地加上偏移。
   */
  private createMesh(typeIndex: number): Mesh {
    const mesh = this.assetLoader.make("tile");
    const [dx, dy, dz] = faceOffset(typeIndex);

    const geometry = mesh.geometry.clone();
    mesh.geometry = geometry;
    const uvs = geometry.attributes.uv.array as Float32Array;
    for (let i = 0; i < uvs.length; i += 2) {
      if (uvs[i] <= TILE_DU && uvs[i + 1] <= TILE_DV) {
        uvs[i] += dx;
        uvs[i + 1] += dy;
      } else if (uvs[i + 1] >= BACK_ROW * TILE_DV) {
        uvs[i + 1] += dz;
      }
    }
    return mesh;
  }

  /** 重建整批牌。开新局、或牌面编号变了（白搭赋值、大小写切换）时调用 */
  replace(startIndex: number, params: Array<ThingParams>): void {
    for (const mesh of this.meshes) {
      (mesh.material as Material).dispose();
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.meshes.splice(0);

    for (const p of params) {
      const mesh = this.createMesh(p.typeIndex);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.startIndex = startIndex;

    if (this.instancedMesh !== null) {
      (this.instancedMesh.material as Material).dispose();
      this.instancedMesh.geometry.dispose();
      this.group.remove(this.instancedMesh);
    }
    this.instancedMesh = this.createInstancedMesh(params);
    this.group.add(this.instancedMesh);
  }

  setSimple(index: number, position: Vector3, rotation: Quaternion): void {
    const i = index - this.startIndex;
    const mesh = this.meshes[i];
    // 位置和朝向都没变就别再上传 instanceMatrix——大部分帧里大部分牌是不动的
    if (!mesh.visible && mesh.position.equals(position) && rotEquals(mesh.quaternion, rotation)) {
      return;
    }
    mesh.position.copy(position);
    mesh.setRotationFromQuaternion(rotation);
    mesh.updateMatrix();
    mesh.visible = false;
    this.instancedMesh!.setMatrixAt(i, mesh.matrix);
    this.instancedMesh!.instanceMatrix.needsUpdate = true;
  }

  setCustom(index: number, position: Vector3, rotation: Quaternion): Mesh {
    const i = index - this.startIndex;
    const mesh = this.meshes[i];
    mesh.position.copy(position);
    mesh.setRotationFromQuaternion(rotation);
    mesh.visible = true;
    this.instancedMesh!.setMatrixAt(i, this.zero);
    this.instancedMesh!.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      (mesh.material as Material).dispose();
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.meshes.splice(0);
    if (this.instancedMesh) {
      (this.instancedMesh.material as Material).dispose();
      this.instancedMesh.geometry.dispose();
      this.group.remove(this.instancedMesh);
      this.instancedMesh = null;
    }
  }
}
