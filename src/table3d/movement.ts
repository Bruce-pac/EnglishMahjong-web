import type { Slot } from "./slot";
import type { Thing } from "./thing";
import { Size, ThingType } from "./types";
import { rectangleOverlap } from "./utils";

type SlotOp = (slot: Slot) => Slot | null;

/** 让位的两个方向，**先左后右**（Autotable 的偏好） */
export const SHIFT_OPS: readonly SlotOp[] = [
  (slot) => slot.links.shiftLeft ?? null,
  (slot) => slot.links.shiftRight ?? null,
];

/**
 * 一次拖动的「谁要去哪」（T3.2，照 Autotable 的 `movement.ts`，研究笔记第四章（中））。
 *
 * **拖动过程中不改 `Thing.slot`**：直接拖的牌记在 `thingMap`，被挤开的记在 `shiftMap`，
 * `reverseMap` 反查「这格已经许给谁了」，防止两张牌抢同一格。每帧鼠标一动就重建一个新的，
 * 所以随时可以放弃，松手之前世界状态一直干净。
 *
 * 与 Autotable 的差别：
 * - 没有 `apply()`。松手后不是直接挪 Thing，而是把结果写回 A 层的 `LooseSlots`
 *   （`insertLoose`）再走一遍 layout → assignThings → 提交——只挪 Thing 的话，
 *   下一次对账会把牌弹回去
 * - 没有 `claimedBy` / `heldRotation` / `rotateHeld`：单人桌，也只在同一排里拖，不换朝向
 */
export class Movement {
  private readonly thingMap = new Map<Thing, Slot>();
  private readonly reverseMap = new Map<Slot, Thing>();
  private readonly shiftMap = new Map<Thing, Slot>();

  move(thing: Thing, slot: Slot): void {
    if (this.reverseMap.has(slot)) throw new Error(`move(): ${slot.name} 已经许给别的牌了`);
    const old = this.thingMap.get(thing);
    if (old !== undefined) this.reverseMap.delete(old);
    this.thingMap.set(thing, slot);
    this.reverseMap.set(slot, thing);
  }

  private shift(thing: Thing, slot: Slot): void {
    this.shiftMap.set(thing, slot);
    this.reverseMap.set(slot, thing);
  }

  get(thing: Thing): Slot | null {
    return this.thingMap.get(thing) ?? null;
  }

  /** 直接拖的牌要去的格子。落点影子读它 */
  slots(): Iterable<Slot> {
    return this.thingMap.values();
  }

  /** 被挤开的牌要去的格子 */
  shifts(): ReadonlyMap<Thing, Slot> {
    return this.shiftMap;
  }

  hasSlot(slot: Slot): boolean {
    return this.reverseMap.has(slot);
  }

  /** 许出去的每一格，要么空着，要么住的正是这次要挪走的牌 */
  valid(): boolean {
    for (const slot of this.reverseMap.keys()) {
      if (slot.thing !== null && !this.thingMap.has(slot.thing) && !this.shiftMap.has(slot.thing)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 给直接拖的牌腾位置。`allThings` 是可能被挤的牌（同一排里的全部）。
   * 失败返回 false，整个 Movement 作废。
   */
  findShift(allThings: Iterable<Thing>, ops: readonly SlotOp[] = SHIFT_OPS): boolean {
    let shift: Map<Slot, Thing> | null = new Map();
    for (const thing of allThings) {
      if (!this.thingMap.has(thing)) shift.set(thing.slot, thing);
    }
    for (const slot of this.thingMap.values()) {
      if (shift.has(slot)) {
        shift = this.findShiftFor(slot, ops, shift);
        if (shift === null) return false;
      }
    }
    for (const [slot, thing] of shift) {
      if (slot.thing !== thing) this.shift(thing, slot);
    }
    return true;
  }

  /** 每个方向在**克隆副本**上试，先成功的那个方向胜出 */
  private findShiftFor(
    slot: Slot,
    ops: readonly SlotOp[],
    shift: Map<Slot, Thing>,
  ): Map<Slot, Thing> | null {
    if (!shift.has(slot)) return null;
    for (const op of ops) {
      const cloned = new Map(shift);
      if (this.tryShift(slot, op, cloned)) return cloned;
    }
    return null;
  }

  /**
   * 占着 `initialSlot` 的牌沿 `op` 挪一格；下一格也有牌就先递归让它挪。
   * 碰到空格成功，碰到链条尽头失败。只改 `shift`（副本），不碰 Thing。
   */
  tryShift(initialSlot: Slot, op: SlotOp, shift: Map<Slot, Thing>): boolean {
    let slot = initialSlot;
    const thing = shift.get(initialSlot)!;
    while (slot === initialSlot || this.reverseMap.has(slot)) {
      const nextSlot = op(slot);
      if (nextSlot === null) return false;
      if (shift.has(nextSlot) && !this.tryShift(nextSlot, op, shift)) return false;
      shift.delete(slot);
      shift.set(nextSlot, thing);
      slot = nextSlot;
    }
    return true;
  }
}

/**
 * 给一张拖着的牌找落点：**重叠面积打分，不是最近距离**（Autotable 的 `world.ts:findSlot`）。
 *
 * 算两次矩形重叠：一次原尺寸，一次双方各外扩半个牌宽，得分 `overlap1 + overlap2 * 0.5`。
 * 外扩那项让牌离格子还有一段距离时就开始吸附——手感从「必须对准」变成「靠近就吸」。
 *
 * @param candidates 允许落的格子。T3.2 只给自己散牌区那一排，别处一律不收
 * @returns 得分最高的格子；和哪格都不沾边（得分不过 1）返回 null
 */
export function findSlot(
  candidates: Iterable<Slot>,
  x: number,
  y: number,
  w: number,
  h: number,
  movement: Movement | null = null,
): Slot | null {
  const margin = Size[ThingType.TILE].x / 2;
  let bestOverlap = 1;
  let bestSlot: Slot | null = null;
  for (const slot of candidates) {
    // 有牌、且没有让位链可挤的格子不收
    if (slot.thing !== null && !slot.links.shiftLeft && !slot.links.shiftRight) continue;
    // 已经许给这次 Movement 里的另一张牌
    if (movement?.hasSlot(slot)) continue;

    const place = slot.place(0);
    const overlap1 = rectangleOverlap(
      x, y, w, h,
      place.position.x, place.position.y, place.size.x, place.size.y,
    );
    const overlap2 = rectangleOverlap(
      x, y, w + margin, h + margin,
      place.position.x, place.position.y, place.size.x + margin, place.size.y + margin,
    );
    const overlap = overlap1 + overlap2 * 0.5;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestSlot = slot;
    }
  }
  return bestSlot;
}
