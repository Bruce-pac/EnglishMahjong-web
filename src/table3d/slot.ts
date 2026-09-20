import { Quaternion, Vector2, Vector3 } from "three";
import type { Thing } from "./thing";
import { Place, Size, ThingType } from "./types";
import { round3, SEAT_ROTATIONS } from "./utils";

/**
 * 槽位之间的关系。
 *
 * Autotable 有五种链接，英语麻将只留下左右两条（需求文档 §8.1）：
 * - `up` / `down`：牌墙叠层。我们的牌墙不可交互，只是「还剩多少张」的视觉
 *   表达（§9 Q6），不需要叠。
 * - `requires`：「先填满那个格子这个才可用」，同样只服务于牌墙和立直牌河。
 * - `push`：立直横牌把后面的牌推开。英语麻将没有立直。
 *
 * 留下的 `shiftLeft` / `shiftRight` 是**手牌重排的全部基础**（§4.1，T3.2 要用）：
 * 往一排里插牌时，靠这条链把已有的牌依次挤开。
 */
interface SlotLinks {
  shiftLeft?: Slot;
  shiftRight?: Slot;
}

type SlotLinkDesc = Partial<Record<keyof SlotLinks, string>>;

/**
 * 格子。牌没有自由坐标，只能停在格子里——这是整个模型的支点：
 * 「牌河自动成行、散牌区自动对齐」全部免费获得，不需要物理引擎。
 *
 * 名字形如 `loose.5@2`（2 号座位散牌区第 5 格）。
 */
export class Slot {
  /** 全名，如 `loose.5@2` */
  name: string;

  /** 组名，如 `loose` */
  group: string;

  type: ThingType;

  origin: Vector3;

  /** 对齐方向：决定牌是从 origin 往 +x/+y 长，还是往 -x/-y 长 */
  direction: Vector2;

  /** 这个格子允许的若干种朝向。`Thing.rotationIndex` 就是这个数组的下标 */
  rotations: Array<Quaternion>;

  /** 格子的整数坐标，如 `discard.1.2@3` 的 indexes 是 [1, 2] */
  indexes: Array<number> = [];

  /** 座位号。`rotate()` 之后才有值 */
  seat: number | null = null;

  /** 与 `rotations` 一一对应的 Place */
  places: Array<Place>;

  /** 当前停在这个格子里的牌 */
  thing: Thing | null = null;

  /** 相关联的槽位——先记名字，全部建好之后由 `setLinks` 换成引用 */
  links: SlotLinks;
  linkDesc: SlotLinkDesc;

  /** 能否多选一起翻面 */
  canFlipMultiple: boolean;

  /** 是否给这个格子画一块常驻影子（空格子也画，提示「这儿可以放牌」） */
  drawShadow: boolean;

  /** 影子按哪种朝向画（下标指向 `rotations`） */
  shadowRotation: number;

  /** 拖着单张牌悬停到这个格子上方时，是否把它转成本格子的朝向 */
  rotateHeld: boolean;

  /**
   * 这个格子里的牌画多大（P6）。自己那排散牌是 `HAND_SCALE`（1.21875），其余都是 1。
   * **不要去改全局的 `Size[ThingType.TILE]`**——那会把四家、牌河、牌墙一起放大
   */
  tileScale: number;

  constructor(params: {
    name: string;
    group: string;
    type?: ThingType;
    origin: Vector3;
    direction?: Vector2;
    rotations: Array<Quaternion>;
    links?: SlotLinkDesc;
    canFlipMultiple?: boolean;
    drawShadow?: boolean;
    shadowRotation?: number;
    rotateHeld?: boolean;
    tileScale?: number;
  }) {
    this.name = params.name;
    this.group = params.group;
    this.type = params.type ?? ThingType.TILE;
    this.origin = params.origin;
    this.direction = params.direction ?? new Vector2(1, 1);
    this.rotations = params.rotations;
    this.linkDesc = params.links ?? {};
    this.canFlipMultiple = params.canFlipMultiple ?? false;
    this.drawShadow = params.drawShadow ?? false;
    this.shadowRotation = params.shadowRotation ?? 0;
    this.rotateHeld = params.rotateHeld ?? false;
    this.tileScale = params.tileScale ?? 1;

    this.places = this.rotations.map((rot) => this.makePlace(rot));
    this.links = {};
  }

  /** 全部格子建好之后，把 `linkDesc` 里的名字换成真正的引用 */
  static setLinks(slots: Map<string, Slot>): void {
    for (const slot of slots.values()) {
      for (const key in slot.linkDesc) {
        const linkName = key as keyof SlotLinks;
        const linkTarget = slot.linkDesc[linkName];
        if (linkTarget !== undefined) {
          slot.links[linkName] = slots.get(linkTarget);
        }
      }
    }
  }

  /** 复制一份并给名字加后缀（`.3` 表示行内第 3 格，`@2` 表示 2 号座位） */
  copy(suffix: string): Slot {
    const linkDesc: SlotLinkDesc = {};
    for (const key in this.linkDesc) {
      const linkName = key as keyof SlotLinks;
      const linkTarget = this.linkDesc[linkName];
      if (linkTarget !== undefined) {
        linkDesc[linkName] = linkTarget + suffix;
      }
    }

    const slot = new Slot({
      name: this.name + suffix,
      group: this.group,
      type: this.type,
      origin: this.origin,
      direction: this.direction,
      rotations: this.rotations,
      tileScale: this.tileScale,
    });
    slot.linkDesc = linkDesc;
    slot.canFlipMultiple = this.canFlipMultiple;
    slot.drawShadow = this.drawShadow;
    slot.shadowRotation = this.shadowRotation;
    slot.rotateHeld = this.rotateHeld;
    slot.indexes = this.indexes.slice();
    return slot;
  }

  /**
   * 把这个格子绕桌心转到 seat 号座位。
   *
   * 布局只为 0 号座位写一次，其余三家转 90°/180°/270° 复制出来。
   * `round3(origin, 16)` 把结果量化到 1/16，挡住浮点漂移（见 utils.ts）。
   */
  rotate(seat: number, worldWidth: number): void {
    const seatRotation = SEAT_ROTATIONS[seat];

    const pos = new Vector3(
      this.origin.x - worldWidth / 2,
      this.origin.y - worldWidth / 2,
      this.origin.z,
    );
    pos.applyQuaternion(seatRotation);
    this.origin = new Vector3(pos.x + worldWidth / 2, pos.y + worldWidth / 2, pos.z);
    round3(this.origin, 16);

    const dir = new Vector3(this.direction.x, this.direction.y, 0);
    dir.applyQuaternion(seatRotation);
    this.direction = new Vector2(Math.round(dir.x), Math.round(dir.y));

    this.rotations = this.rotations.map((rot) => rot.clone().premultiply(seatRotation));
    this.places = this.rotations.map((rot) => this.makePlace(rot));

    this.seat = seat;
  }

  /**
   * 按朝向算这个格子的摆放姿态。
   *
   * 牌是 6×9×4 的长方体，转过之后它占的**轴对齐包围盒**尺寸会变（正放 vs 侧放）。
   * 做法是把三个基向量分别转过去，各轴取绝对值最大的分量。
   * `origin` 是包围盒的角，`direction` 决定往哪一侧长。
   */
  makePlace(rotation: Quaternion): Place {
    const dim = Size[this.type].clone().multiplyScalar(this.tileScale);

    const xv = new Vector3(0, 0, dim.z).applyQuaternion(rotation);
    const yv = new Vector3(0, dim.y, 0).applyQuaternion(rotation);
    const zv = new Vector3(dim.x, 0, 0).applyQuaternion(rotation);
    const maxx = Math.max(Math.abs(xv.x), Math.abs(yv.x), Math.abs(zv.x));
    const maxy = Math.max(Math.abs(xv.y), Math.abs(yv.y), Math.abs(zv.y));
    const maxz = Math.max(Math.abs(xv.z), Math.abs(yv.z), Math.abs(zv.z));

    return {
      position: new Vector3(
        this.origin.x + (maxx / 2) * this.direction.x,
        this.origin.y + (maxy / 2) * this.direction.y,
        this.origin.z + maxz / 2,
      ),
      rotation,
      size: new Vector3(maxx, maxy, maxz),
      scale: this.tileScale,
    };
  }

  /**
   * 这个格子的第 rotationIndex 种姿态。
   *
   * Autotable 这里是 `placeWithOffset()`，要叠加立直横牌推挤产生的 `offset`。
   * 英语麻将没有推挤，所以直接返回。
   */
  place(rotationIndex: number): Place {
    return this.places[rotationIndex];
  }
}
