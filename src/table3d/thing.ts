import { Slot } from "./slot";
import { Place, ThingType } from "./types";

/**
 * 桌面上的一张牌。
 *
 * **Thing 没有坐标**——位置永远由 `slot.place(rotationIndex)` 算出来。
 * 这是整个模型的支点（研究笔记第二章）。
 *
 * Autotable 的 `claimedBy` / `heldRotation` / `sent` 是多人同步用的（谁抓着这张牌、
 * 抓起时的朝向、有没有同步给服务器），英语麻将是单人 + 3 AI，全部裁掉（需求文档 §8.1）。
 * `shiftSlot` 留着：那是拖动过程中的「预览落点」，纯本地状态，T3.2 要用。
 *
 * `index` 是**前端自建的牌张身份**。服务端下发的是排序过的多重集，没有牌张 id
 * （总纲 §1），所以身份必须由前端维护——T1.4 的对账层负责让它跨 envelope 稳定。
 */
export class Thing {
  index: number;
  type: ThingType;

  /** 牌面编号，见需求文档 §7.1 的编号表（0-25 大写、26-51 小写、52+ 白搭） */
  typeIndex: number;

  slot: Slot;

  /** 用的是 `slot.rotations` 里的第几种朝向。正面朝上 / 背面朝上靠它区分 */
  rotationIndex: number;

  /** 拖动中的预览落点。不拖动时为 null */
  shiftSlot: Slot | null;

  /** 让位动画用：上一个预览落点和它生效的时刻（T3.2 的 100ms 插值） */
  lastShiftSlot: Slot | null;
  lastShiftSlotTime: number;

  constructor(index: number, type: ThingType, typeIndex: number, slot: Slot) {
    this.index = index;
    this.type = type;
    this.typeIndex = typeIndex;
    this.slot = slot;
    this.rotationIndex = 0;
    this.shiftSlot = null;
    this.lastShiftSlot = null;
    this.lastShiftSlotTime = 0;

    this.slot.thing = this;
  }

  place(): Place {
    return this.slot.place(this.rotationIndex);
  }

  /** 翻面：不给参数就翻到下一种朝向，循环 */
  flip(rotationIndex?: number): void {
    const target = rotationIndex ?? this.rotationIndex + 1;
    const r = this.slot.rotations.length;
    this.rotationIndex = ((target % r) + r) % r;
  }

  /** 先腾空原格子。`moveTo` 之前调用，否则整批换位时会互相判为「格子非空」 */
  prepareMove(): void {
    this.slot.thing = null;
  }

  moveTo(target: Slot, rotationIndex?: number): void {
    if (target.thing !== null) {
      throw new Error(`格子非空：thing ${this.index} → ${target.name}`);
    }
    this.slot = target;
    this.rotationIndex = rotationIndex ?? 0;
    target.thing = this;
  }

  shiftTo(slot: Slot | null): void {
    this.shiftSlot = slot;
  }

  release(): void {
    this.shiftSlot = null;
  }
}
