/**
 * T2.3d：三个 AI 角色上桌（**只在透视模式**，按 p 切）。
 *
 * 正交模式下桌子几乎顶满画面、没地方坐人，用户定了**不许为此缩小牌桌**，所以角色只在透视里出现。
 * 模型是静态网格、没有骨骼，表达只靠三样：轮到谁谁前倾并提亮、极轻微的呼吸浮动、回放气泡从头顶冒出。
 *
 * 坐标换算（`character-loader.ts`：模型原点在脚底中心、Y 朝上、面朝 +Z，高约 1.02）：
 * 1. 绕 X 轴 +90°：模型的「上」→ 世界 +Z，「正面」→ 世界 −Y
 * 2. 再绕 Z 转 180°：面朝 +Y（朝桌心）——这是**座位 0 版本**，放在桌子下沿外侧
 * 3. 其余座位套用 `SEAT_ROTATIONS[s]` 绕桌心转，和槽位是同一套（`Slot.rotate`），不四个方向各自手算
 */

import { Color, Group as ThreeGroup, Matrix4, Quaternion, Vector3 } from "three";
import type { Group, Material, Mesh, MeshLambertMaterial, Object3D } from "three";
import { WORLD_SIZE } from "./layout";
import { SEAT_ROTATIONS } from "./utils";
import { CHARACTER_SEATS, loadCharacters, type CharacterSeat, type Characters } from "./character-loader";

/** 模型原始身高（glTF 单位）。三人实测 1.006 / 1.025 / 1.011，按 1.02 统一缩放，保留彼此的相对身高 */
const MODEL_HEIGHT = 1.02;
/**
 * 角色在世界里的身高（世界单位）。参照物：一张牌 6×9×4，一排散牌 18 格约 108 宽。
 * **用户从 60 / 90 / 120 三档截图里挑定的 60**：1400×933 透视默认视角下只有这一档三个人都完整入画
 * ——对家的头刚好贴着画面上沿；90 起对家的头被切掉、左右两家出框
 */
export const CHARACTER_HEIGHT = 60;
/** 脚底离桌沿（y=0 那条边）多远。桌面比槽位区多一圈台面（半个牌高 4.5），再往外留一点；与 60 那档一起截图定的 */
export const CHARACTER_GAP = 22;

/** 行动方前倾多少（绕脚底那条横轴，朝桌心） */
export const LEAN_ANGLE = (8 * Math.PI) / 180;
/**
 * 行动方提亮多少：自发光 = 这个系数 × **贴图本身的颜色**（`emissiveMap` 就是颜色贴图）。
 *
 * **不能用纯色 emissive**：那是给整个模型均匀加一层灰，深色（头发、衣服）被抬成灰色，
 * 调多少都像蒙了一层雾（T2.3d 实测 0.14 发灰、0.06 仍然发灰，审查截图为证）。
 * 按贴图成比例提亮，黑发加的量接近零、还是黑的，只有本来就亮的地方变得更亮
 */
const LIT_EMISSIVE = 0.3;
/** 换人时的缓动时长 */
const LEAN_TIME = 150;
/** 呼吸：竖直方向缩放的振幅（相对值）与周期。小到只是「活着」的感觉 */
const BREATH_AMPLITUDE = 0.006;
const BREATH_PERIOD = 4200;

const CENTER = new Vector3(WORLD_SIZE / 2, WORLD_SIZE / 2, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** 模型空间 → 座位 0 版本的朝向：先绕 X +90°，再绕 Z 180° */
const BASE_ROTATION = new Quaternion()
  .setFromAxisAngle(Z_AXIS, Math.PI)
  .multiply(new Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2));

/**
 * 某座位角色的世界矩阵（纯函数）。`lean` 是前倾角度（弧度），`breath` 是竖直缩放的偏移（0 = 不动）。
 * 前倾和呼吸都在**模型空间**里做：前倾绕模型 X 轴（脚底那条横轴）转，头往 +Z（正面）走；
 * 呼吸只拉伸模型 Y（竖直），脚底不动
 */
export function characterMatrix(
  seat: number,
  lean = 0,
  breath = 0,
  height = CHARACTER_HEIGHT,
  gap = CHARACTER_GAP,
): Matrix4 {
  const scale = height / MODEL_HEIGHT;
  const seatRot = SEAT_ROTATIONS[seat];
  // 座位 0 版本的位置：桌子下沿外侧，再绕桌心转到该座位
  const pos = new Vector3(WORLD_SIZE / 2, -gap, 0).sub(CENTER).applyQuaternion(seatRot).add(CENTER);
  const rot = seatRot.clone().multiply(BASE_ROTATION).multiply(new Quaternion().setFromAxisAngle(X_AXIS, lean));
  return new Matrix4().compose(pos, rot, new Vector3(scale, scale * (1 + breath), scale));
}

/** 头顶附近（世界坐标）：回放气泡的锚点。不含前倾——气泡不必跟着那 8° 晃 */
export function headAnchor(seat: number, height = CHARACTER_HEIGHT, gap = CHARACTER_GAP): Vector3 {
  return new Vector3().setFromMatrixPosition(characterMatrix(seat, 0, 0, height, gap)).setZ(height * 1.08);
}

/**
 * 透视下「第 N 胡」标记的锚点：角色**身侧**、约肩高。牌排上方那个锚点（`looseRowAnchor`）在透视里
 * 正好投影到角色身上（对家的标记压在她胸口，T2.3d 实测）。
 * 对家挪到她身侧（世界 +x，画面右边、约肩高）；左右两家挪到**桌沿**那侧（角色与亮词之间、半身高）——
 * 往身侧挪的话，从镜头看过去仍蹭到他们的手臂（实测）。都落在角色轮廓之外
 */
export function markerAnchor(seat: number, height = CHARACTER_HEIGHT, gap = CHARACTER_GAP): Vector3 {
  const feet = new Vector3().setFromMatrixPosition(characterMatrix(seat, 0, 0, height, gap));
  if (seat === 2) return feet.add(new Vector3(height * 0.75, 0, 0)).setZ(height * 0.55);
  const toCenter = CENTER.clone().sub(feet).setZ(0).normalize();
  return feet.add(toCenter.multiplyScalar(gap + 4)).setZ(height * 0.35);
}

/** 行动方 → 哪几家前倾。自己（0）和没人（null）没有角色可前倾 */
export function leaningSeats(actor: number | null): CharacterSeat[] {
  return CHARACTER_SEATS.filter((s) => s === actor);
}

/**
 * 场景里的三个角色：懒加载、只在透视显示、前倾 + 提亮、呼吸。
 * 不参与拾取、不进 OutlinePass、不进 Thing 池——它们只是挂在 mainGroup 上的普通网格
 */
export class CharacterLayer {
  private chars: Characters | null = null;
  /**
   * 每家一个外层 Group，摆位矩阵设在它身上。**不直接改模型对象的 matrix**：glTF 节点自带变换
   * （导出器写进去的旋转），覆盖掉就整个人仰面朝天
   */
  private holders = new Map<CharacterSeat, ThreeGroup>();
  private loading = false;
  private disposed = false;
  private visible = false;
  private actor: number | null = null;
  /** 每家当前的前倾进度（0..1），缓动到目标 */
  private lean = new Map<CharacterSeat, { from: number; to: number; start: number }>();
  /** 每家的材质（提亮改 emissive） */
  private materials = new Map<CharacterSeat, MeshLambertMaterial[]>();
  private fadeStart = 0;

  constructor(private readonly group: Group) {}

  /** 行动方（`actorOf` 的结果）。记分盘亮哪家，这里就前倾哪家 */
  setActor(actor: number | null, now = performance.now()): void {
    if (actor === this.actor) return;
    this.actor = actor;
    const want = new Set(leaningSeats(actor));
    for (const seat of CHARACTER_SEATS) {
      const cur = this.progress(seat, now);
      const to = want.has(seat) ? 1 : 0;
      this.lean.set(seat, { from: cur, to, start: now });
    }
  }

  /** 已加载且正在显示 */
  get shown(): boolean {
    return this.visible && this.chars !== null;
  }

  private progress(seat: CharacterSeat, now: number): number {
    const l = this.lean.get(seat);
    if (!l) return 0;
    const t = Math.min(1, (now - l.start) / LEAN_TIME);
    const k = 1 - (1 - t) ** 3;
    return l.from + (l.to - l.from) * k;
  }

  /** 每帧调。透视才显示；第一次进透视时开始加载，失败了下次进透视再试 */
  update(now: number, perspective: boolean): void {
    this.visible = perspective;
    if (perspective && !this.chars && !this.loading) this.load();
    if (!this.chars) return;
    const fade = Math.min(1, (now - this.fadeStart) / 400);
    for (const seat of CHARACTER_SEATS) {
      const obj = this.holders.get(seat)!;
      obj.visible = perspective;
      if (!perspective) continue;
      const p = this.progress(seat, now);
      // 三家相位错开 1/3 周期，别同步起伏
      const breath = BREATH_AMPLITUDE * Math.sin((2 * Math.PI * now) / BREATH_PERIOD + (seat * 2 * Math.PI) / 3);
      obj.matrix.copy(characterMatrix(seat, LEAN_ANGLE * p, breath));
      obj.matrixWorldNeedsUpdate = true;
      obj.updateMatrixWorld(true);
      for (const m of this.materials.get(seat) ?? []) {
        m.emissive.setScalar(LIT_EMISSIVE * p);
        m.opacity = fade;
        m.transparent = fade < 1;
      }
    }
  }

  private load(): void {
    this.loading = true;
    loadCharacters()
      .then((chars) => {
        if (this.disposed) return;
        this.chars = chars;
        this.fadeStart = performance.now();
        for (const seat of CHARACTER_SEATS) {
          const model = chars[seat];
          model.updateMatrix(); // 节点自带的变换（旋转）保留在模型自己身上
          const obj = new ThreeGroup();
          obj.matrixAutoUpdate = false; // mainGroup 是全手动矩阵，外层每帧自己算
          obj.add(model);
          const mats: MeshLambertMaterial[] = [];
          model.traverse((o) => {
            o.raycast = () => {}; // 不参与拾取
            const mesh = o as Mesh;
            if (!mesh.isMesh) return;
            for (const m of ([] as Material[]).concat(mesh.material)) {
              const lm = m as MeshLambertMaterial;
              lm.emissive = new Color(0, 0, 0);
              // 提亮按贴图颜色成比例（见 LIT_EMISSIVE）。加了贴图要重新编译着色器，只在这里做一次
              lm.emissiveMap = lm.map;
              lm.needsUpdate = true;
              mats.push(lm);
            }
          });
          this.materials.set(seat, mats);
          this.holders.set(seat, obj);
          obj.visible = this.visible;
          this.group.add(obj);
          obj.updateMatrixWorld(true);
        }
      })
      .catch((e) => {
        // 网络断了：透视照常能用，只是没有角色；下次进透视再试
        console.warn("角色模型加载失败，这次透视不显示角色", e);
      })
      .finally(() => {
        this.loading = false;
      });
  }

  /** 气泡锚点：透视且角色已加载时在头顶，否则 null（调用方退回牌排上方） */
  bubbleAnchor(seat: number): Vector3 | null {
    if (!this.shown || !CHARACTER_SEATS.includes(seat as CharacterSeat)) return null;
    return headAnchor(seat);
  }

  /** 「第 N 胡」锚点：透视且角色已加载时在角色身侧，否则 null（调用方退回牌排上方，正交行为不变） */
  winMarkerAnchor(seat: number): Vector3 | null {
    if (!this.shown || !CHARACTER_SEATS.includes(seat as CharacterSeat)) return null;
    return markerAnchor(seat);
  }

  dispose(): void {
    this.disposed = true;
    if (!this.chars) return;
    for (const seat of CHARACTER_SEATS) {
      const obj: Object3D = this.chars[seat];
      const holder = this.holders.get(seat);
      if (holder) this.group.remove(holder);
      holder?.remove(obj);
      obj.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of ([] as Material[]).concat(mesh.material)) {
          (m as MeshLambertMaterial).map?.dispose();
          m.dispose();
        }
      });
    }
    this.chars = null;
  }
}
