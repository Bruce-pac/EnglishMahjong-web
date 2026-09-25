import {
  Box3,
  BoxGeometry,
  Camera,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { LOOSE_SLOTS, WORLD_SIZE } from "./layout";
import type { Place } from "./types";

/** 一个可拾取的目标：Thing 编号 + 它这一帧的摆放姿态（取其 AABB） */
export interface PickTarget {
  id: number;
  place: Place;
}

/** P22 悬停区：别家亮词区的牌、别家摊开的正面牌。只读，不参与拖动 / 框选 */
export interface HoverTarget {
  seat: number;
  kind: "meld" | "concealed";
  place: Place;
}

/**
 * T3.1：鼠标拾取（研究笔记 §4.1、§4.2，照 Autotable 的 `mouse-ui.ts`）。
 *
 * **射线从不打真牌**：真牌全在 InstancedMesh 里，raycast 慢且不准。改打一组不可见的
 * 单位立方体代理体，每帧把可拾取牌的 AABB 写进去，`userData.id` 挂 Thing 编号。
 *
 * 能拾取的只有自己散牌区（`loose@我`）的牌，所以代理体池只建 `LOOSE_SLOTS` 个。
 * 别家的牌、牌墙、亮词区、牌河都不进池——牌河在 T3.4 是拖放的落点，不是拾取对象。
 *
 * 这个类**不存相机**：`p` 切透视会换掉相机对象，每次调用都由调用方传当前那台。
 * 也不挂鼠标监听——鼠标坐标只有 `Table3D.tsx` 那一份（`mouse2`）。
 */
export class MouseUi {
  private readonly raycaster = new Raycaster();
  private readonly raycastGroup = new Group();
  private readonly raycastObjects: Mesh[] = [];
  private readonly raycastTable: Mesh;
  private readonly boxGeometry = new BoxGeometry(1, 1, 1);

  /** 这一帧参与拾取的代理体（池的前缀） */
  private currentObjects: Mesh[] = [];

  private readonly viewToWorld = new Matrix4();
  private readonly frustum = new Frustum();

  constructor(private readonly mainGroup: Group) {
    this.raycastGroup.visible = false;
    this.raycastGroup.matrixAutoUpdate = false;
    this.mainGroup.add(this.raycastGroup);

    for (let i = 0; i < LOOSE_SLOTS; i++) {
      const obj = new Mesh(this.boxGeometry);
      obj.name = "raycastBox";
      obj.visible = false;
      obj.matrixAutoUpdate = false;
      this.raycastObjects.push(obj);
      this.raycastGroup.add(obj);
    }

    // 三倍桌面大：拖到桌外也要有坐标。T3.2 拖动时把它抬到抓起那张牌的高度
    this.raycastTable = new Mesh(new PlaneGeometry(WORLD_SIZE * 3, WORLD_SIZE * 3));
    this.raycastTable.visible = false;
    this.raycastTable.matrixAutoUpdate = false;
    this.raycastTable.position.set(WORLD_SIZE / 2, WORLD_SIZE / 2, 0);
    this.raycastGroup.add(this.raycastTable);

    // 场景是全手动矩阵（main-view.ts），挂上来之后自己同步一次
    this.raycastGroup.updateMatrixWorld(true);
    this.raycastTable.updateMatrix();
    this.raycastTable.updateMatrixWorld();
  }

  /**
   * 把这一帧可拾取的牌写进代理体。超过池子的部分丢掉并告警——
   * 散牌区最多 `LOOSE_SLOTS` 格，超了说明调用方把别的区也塞进来了。
   */
  updateObjects(targets: readonly PickTarget[]): void {
    if (targets.length > this.raycastObjects.length) {
      console.warn(`可拾取的牌超过代理体池：${targets.length} > ${this.raycastObjects.length}`);
    }
    // 照搬 Autotable：薄物件撑到 3 才点得中。牌正面 6×9，基本碰不到这条
    const minSize = 3;
    const n = Math.min(targets.length, this.raycastObjects.length);
    this.currentObjects = this.raycastObjects.slice(0, n);
    for (let i = 0; i < n; i++) {
      const { id, place } = targets[i];
      const obj = this.raycastObjects[i];
      obj.position.copy(place.position);
      obj.scale.copy(place.size);
      if (obj.scale.x < minSize) obj.scale.x = minSize;
      if (obj.scale.y < minSize) obj.scale.y = minSize;
      obj.updateMatrix();
      obj.updateMatrixWorld();
      obj.userData.id = id;
    }
  }

  /**
   * P22：光标下是哪一家的亮词 / 摊开的暗词。和 `pick()` 用**同一套反投影**（`setRay`），
   * 但不动代理体池——自己散牌区那套拾取一行不改。取离相机最近的那一格
   */
  hoverHit(mouse2: Vector2, camera: Camera, targets: readonly HoverTarget[]): { seat: number; kind: "meld" | "concealed" } | null {
    if (targets.length === 0) return null;
    this.setRay(mouse2, camera);
    const ray = this.raycaster.ray;
    let best: HoverTarget | null = null;
    let bestDist = Infinity;
    for (const t of targets) {
      const half = t.place.size.clone().multiplyScalar(0.5);
      this.hoverBox.set(t.place.position.clone().sub(half), t.place.position.clone().add(half));
      this.hoverBox.applyMatrix4(this.mainGroup.matrixWorld);
      const p = ray.intersectBox(this.hoverBox, this.hoverPoint);
      if (!p) continue;
      const d = p.distanceTo(ray.origin);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best ? { seat: best.seat, kind: best.kind } : null;
  }
  private readonly hoverBox = new Box3();
  private readonly hoverPoint = new Vector3();

  /** 鼠标（归一化 -1..1）指着哪张牌。没指着可拾取的牌返回 null */
  pick(mouse2: Vector2, camera: Camera): number | null {
    this.setRay(mouse2, camera);
    const hits = this.raycaster.intersectObjects(this.currentObjects, false);
    return hits.length > 0 ? (hits[0].object.userData.id as number) : null;
  }

  /**
   * 鼠标在高度 z 的水平面上对应的点（`mainGroup` 局部坐标）。
   * 射线与平面平行、或平面在身后时返回 null。T3.2 拖动用。
   */
  raycastLevel(mouse2: Vector2, camera: Camera, z = 0): Vector3 | null {
    if (this.raycastTable.position.z !== z) {
      this.raycastTable.position.z = z;
      this.raycastTable.updateMatrix();
      this.raycastTable.updateMatrixWorld();
    }
    this.setRay(mouse2, camera);
    const hits = this.raycaster.intersectObject(this.raycastTable, false);
    if (hits.length === 0) return null;
    // 相机组在转、牌不在转，坐标统一回 mainGroup
    return this.mainGroup.worldToLocal(hits[0].point.clone());
  }

  /**
   * 框选（T3.3，照 Autotable 的 `selection-box.ts`，研究笔记 §4.3）：屏幕上的矩形
   * （两个归一化角点）反投影回世界空间构成视锥，和代理体的 AABB 做 `intersectsBox`。
   * 只在 `updateObjects` 给的候选里挑，所以框到别家的牌、牌墙、牌河也不算。
   *
   * 反投影和 `setRay` 一样走渲染用的视图矩阵，不走带 scale 的 `matrixWorld`。
   * 透视和正交都按「近平面四角 + 远平面四角」建六个面，不分支。
   */
  select(a: Vector2, b: Vector2, camera: Camera): number[] {
    let left = Math.min(a.x, b.x);
    let right = Math.max(a.x, b.x);
    let down = Math.min(a.y, b.y);
    let top = Math.max(a.y, b.y);
    // 退化矩形保护：单击时宽高为 0，setFromCoplanarPoints 会算出退化平面、整个视锥失效
    const eps = 0.01;
    if (right - left < eps) {
      left -= eps / 2;
      right += eps / 2;
    }
    if (top - down < eps) {
      down -= eps / 2;
      top += eps / 2;
    }

    const toWorld = this.viewToWorld.copy(camera.matrixWorldInverse).invert();
    const un = (x: number, y: number, z: number) =>
      new Vector3(x, y, z).applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(toWorld);
    const tl = un(left, top, -1);
    const tr = un(right, top, -1);
    const dr = un(right, down, -1);
    const dl = un(left, down, -1);
    const ftl = un(left, top, 1);
    const ftr = un(right, top, 1);
    const fdr = un(right, down, 1);
    const fdl = un(left, down, 1);

    const planes = this.frustum.planes;
    planes[0].setFromCoplanarPoints(tl, ftl, ftr);
    planes[1].setFromCoplanarPoints(tr, ftr, fdr);
    planes[2].setFromCoplanarPoints(fdr, fdl, dl);
    planes[3].setFromCoplanarPoints(fdl, ftl, tl);
    planes[4].setFromCoplanarPoints(tr, dr, dl);
    planes[5].setFromCoplanarPoints(fdr, ftr, ftl);
    planes[5].normal.multiplyScalar(-1);

    const box = new Box3();
    const hits: number[] = [];
    if (!this.boxGeometry.boundingBox) this.boxGeometry.computeBoundingBox();
    for (const obj of this.currentObjects) {
      box.copy(this.boxGeometry.boundingBox!).applyMatrix4(obj.matrixWorld);
      if (this.frustum.intersectsBox(box)) hits.push(obj.userData.id as number);
    }
    return hits;
  }

  /**
   * `mainGroup` 局部坐标 → 屏幕归一化坐标。选框起点按世界坐标记，每帧用它投回屏幕，
   * 镜头动了（缩放、低头）选框也跟着桌面走。`project()` 走的正是渲染用的视图矩阵
   */
  project(p: Vector3, camera: Camera): Vector2 {
    const v = this.mainGroup.localToWorld(p.clone()).project(camera);
    return new Vector2(v.x, v.y);
  }

  /**
   * 从相机发一条过鼠标的射线。**不用 `Raycaster.setFromCamera`**：
   *
   * three r185 算视图矩阵时把相机的 scale 剔掉了（`Camera.updateMatrixWorld`，注释是
   * 「exclude scale from view matrix to be glTF conform」），渲染用的就是这个
   * `matrixWorldInverse`；而 `setFromCamera` 反投影走的是带 scale 的 `matrixWorld`。
   * 两边一旦不一致，指着的牌和高亮的牌就差出 scale 倍。
   *
   * main-view 现在已经改用 `camera.zoom` 缩放、不再给相机设 scale，但这里仍然坚持用
   * `matrixWorldInverse` 的逆——画面怎么投影的，射线就怎么反投影回去。
   * 以后谁再给相机设 scale，拾取也不会跟画面错开（测试里的 scaleGuard 守着这一点）。
   */
  private setRay(mouse2: Vector2, camera: Camera): void {
    const toWorld = this.viewToWorld.copy(camera.matrixWorldInverse).invert();
    const ray = this.raycaster.ray;
    if ((camera as OrthographicCamera).isOrthographicCamera) {
      // 正交：起点在近平面上鼠标那一点，方向恒为相机的 -z
      ray.origin
        .set(mouse2.x, mouse2.y, -1)
        .applyMatrix4(camera.projectionMatrixInverse)
        .applyMatrix4(toWorld);
      ray.direction.set(0, 0, -1).transformDirection(toWorld);
    } else {
      // 透视：起点是相机位置，方向指向鼠标在远处的那一点
      ray.origin.setFromMatrixPosition(toWorld);
      ray.direction
        .set(mouse2.x, mouse2.y, 0.5)
        .applyMatrix4(camera.projectionMatrixInverse)
        .applyMatrix4(toWorld)
        .sub(ray.origin)
        .normalize();
    }
    this.raycaster.camera = camera;
  }

  dispose(): void {
    this.boxGeometry.dispose();
    this.raycastTable.geometry.dispose();
    this.mainGroup.remove(this.raycastGroup);
  }
}
