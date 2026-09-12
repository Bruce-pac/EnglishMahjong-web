import {
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
} from "three";
import { AssetLoader } from "./asset-loader";
import { ThingParams, TileThingGroup } from "./thing-group";
import { Place } from "./types";

/** 一张牌这一帧要怎么画 */
/** 悬停时牌面自发光的强度（0..1）。调这里就能调悬停高亮的明显程度 */
const HOVER_GLOW = 0.2;

export interface Render {
  thingIndex: number;
  place: Place;
  selected: boolean;
  hovered: boolean;
  held: boolean;
  /** 落点非法 / 临时态，画半透明 */
  temporary: boolean;
  /** 被压在别的牌下面，画暗一点 */
  bottom: boolean;
  /** 属于某个暗词（T4.3）：交给第二个 OutlinePass 描暗词框。可省略，默认不是 */
  grouped?: boolean;
}

/**
 * 静态槽位影子的上限。四家加起来实际用到：
 *
 * ```
 *   散牌区 18×4 = 72   亮词区 38×4 = 152
 *   牌河   28×4 = 112  牌墙   (15+13×3) = 54   （一墩只画下层）
 *   合计 390
 * ```
 *
 * 留到 512。改布局常量把总数顶上去时，`replaceShadows()` 会当场告警——
 * 不然只会「有些格子没影子」，看着像随机漏画。
 */
const MAX_SHADOWS = 512;

/**
 * 场景里「牌 + 影子」这一层。
 *
 * **不开 shadow map**：影子全是贴地的半透明黑色平面（研究笔记 §3.4）。
 * 桌面是平的，视觉损失几乎为零，却省掉整个 shadow pass。两套：
 * - 静态槽位影子：`drawShadow` 的格子画常驻淡影（opacity 0.1），告诉玩家「牌该放这」
 * - 落点影子：拖动时实时生成（opacity 0.2），跟着手走
 */
export class ObjectView {
  readonly mainGroup: Group;
  private tileGroup: TileThingGroup;

  private shadowObject: InstancedMesh;
  private dropShadowProto: Mesh;
  private dropShadowObjects: Array<Mesh> = [];

  /** 这一帧被选中的牌，交给 OutlinePass 描金边（T3.3） */
  readonly selectedObjects: Array<Mesh> = [];
  /** 这一帧属于暗词的牌，交给第二个 OutlinePass 描暗词框（T4.3） */
  readonly groupedObjects: Array<Mesh> = [];

  constructor(mainGroup: Group, assetLoader: AssetLoader) {
    this.mainGroup = mainGroup;
    this.tileGroup = new TileThingGroup(assetLoader, mainGroup);

    const plane = new PlaneGeometry(1, 1, 1);
    const shadowMaterial = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.1,
      color: 0,
      depthWrite: false,
    });
    this.shadowObject = new InstancedMesh(plane, shadowMaterial, MAX_SHADOWS);
    this.shadowObject.count = 0;
    this.mainGroup.add(this.shadowObject);

    const dropMaterial = shadowMaterial.clone();
    dropMaterial.opacity = 0.2;
    this.dropShadowProto = new Mesh(plane, dropMaterial);
    this.dropShadowProto.name = "dropShadow";
  }

  replaceThings(params: Array<ThingParams>): void {
    if (params.length === 0) return;
    const sorted = [...params].sort((a, b) => a.index - b.index);
    this.tileGroup.replace(sorted[0].index, sorted);
  }

  /**
   * 只换牌面、不重建（T1.4 方案 §5）。白搭赋值、切大小写走这条。
   *
   * **两阶段：先全部试探、再统一提交。** 现在只有一个组，将来分组多了，
   * 一半走快路径、另一半回退重建会让两边状态不同步——所以只要有一个组
   * `canUpdateTypes()` 不通过，整批都回退到 `replaceThings()`。
   *
   * 调用方要**批量**触发：对账层输出整批 Placement，不要逐张调。
   */
  updateThingTypes(params: Array<ThingParams>): void {
    if (params.length === 0) return;
    const sorted = [...params].sort((a, b) => a.index - b.index);
    if (!this.tileGroup.canUpdateTypes(sorted[0].index, sorted)) {
      this.tileGroup.replace(sorted[0].index, sorted);
      return;
    }
    this.tileGroup.updateTypes(sorted);
  }

  /** 测试用：透出渲染组，好让不变式 2 比对 offset 属性与 uv 数组 */
  get tiles(): TileThingGroup {
    return this.tileGroup;
  }

  /** 铺静态槽位影子。槽位不变就只在开局调一次 */
  replaceShadows(places: Array<Place>): void {
    if (places.length > MAX_SHADOWS) {
      console.warn(`槽位影子超过上限：${places.length} > ${MAX_SHADOWS}，多的不画`);
    }
    const dummy = new Object3D();
    this.shadowObject.count = 0;
    for (const place of places) {
      if (this.shadowObject.count >= MAX_SHADOWS) break;
      dummy.position.set(place.position.x, place.position.y, 0.1);
      dummy.scale.set(place.size.x, place.size.y, 1);
      dummy.updateMatrix();
      this.shadowObject.setMatrixAt(this.shadowObject.count++, dummy.matrix);
    }
    this.shadowObject.instanceMatrix.needsUpdate = true;
  }

  /** 每帧决定每张牌走 Simple 还是 Custom */
  updateThings(things: Array<Render>): void {
    this.selectedObjects.splice(0);
    this.groupedObjects.splice(0);
    for (const thing of things) {
      // OutlinePass 描不了 InstancedMesh 里的某一个实例，所以暗词的牌也得走 Custom 轨
      const custom = thing.hovered || thing.selected || thing.held || thing.bottom || !!thing.grouped;
      if (!custom) {
        this.tileGroup.setSimple(thing.thingIndex, thing.place.position, thing.place.rotation);
        continue;
      }

      const obj = this.tileGroup.setCustom(
        thing.thingIndex,
        thing.place.position,
        thing.place.rotation,
      );
      const material = obj.material as MeshLambertMaterial;
      const wasTransparent = material.transparent;

      material.color.setRGB(1, 1, 1);
      material.emissive.setRGB(0, 0, 0);
      material.transparent = false;
      material.depthTest = true;
      obj.renderOrder = 0;

      // Autotable 用 0.05，但我们的环境光是 1.45、牌面本来就很亮，0.05 只亮了 18/255，
      // 肉眼几乎看不出来。悬停要一眼可见；选中另有金色描边（OutlinePass），两者不会混
      if (thing.hovered) material.emissive.setRGB(HOVER_GLOW, HOVER_GLOW, HOVER_GLOW);
      if (thing.bottom) material.color.setRGB(0.8, 0.8, 0.8);
      if (thing.selected) this.selectedObjects.push(obj);
      if (thing.grouped) this.groupedObjects.push(obj);
      if (thing.held) {
        // 抓在手里的牌永远浮在最上面，不被别的牌挡住
        material.transparent = true;
        material.opacity = thing.temporary ? 0.7 : 1;
        material.depthTest = false;
        obj.position.z += 1;
        obj.renderOrder = 1;
      }

      // transparent 一变就要重编译，不变时别乱设——否则每帧都在重编译着色器
      if (material.transparent !== wasTransparent) material.needsUpdate = true;

      obj.updateMatrix();
      obj.updateMatrixWorld();
    }
  }

  /** 这一帧没被摆上桌的实例。见 `TileThingGroup.setHidden` */
  hideThing(index: number): void {
    this.tileGroup.setHidden(index);
  }

  updateDropShadows(places: Array<Place>): void {
    for (const obj of this.dropShadowObjects) this.mainGroup.remove(obj);
    this.dropShadowObjects.splice(0);

    for (const place of places) {
      const obj = this.dropShadowProto.clone();
      obj.position.set(
        place.position.x,
        place.position.y,
        place.position.z - place.size.z / 2 + 0.2,
      );
      obj.scale.set(place.size.x, place.size.y, 1);
      this.dropShadowObjects.push(obj);
      this.mainGroup.add(obj);
      obj.updateMatrixWorld();
    }
  }

  dispose(): void {
    this.tileGroup.dispose();
    this.shadowObject.geometry.dispose();
    (this.shadowObject.material as MeshBasicMaterial).dispose();
    this.mainGroup.remove(this.shadowObject);
    (this.dropShadowProto.material as MeshBasicMaterial).dispose();
    for (const obj of this.dropShadowObjects) this.mainGroup.remove(obj);
    this.dropShadowObjects.splice(0);
  }
}
