/**
 * P8：暗词框分两个描边通道。
 *
 * 一个 OutlinePass 描的是所有对象的**并集**轮廓，CAT、DOG 挨着就成了一个 CATDOG 框。
 * 所以两个通道轮流分：按每个暗词最左一张的格子从左到右排，依次 0、1、0、1……
 * 暗词正常是连续一块（组暗词时 compactGroup 收拢），紧挨着的两个一定落在不同通道。
 *
 * 暗词的牌散开或互相夹杂（刷新后从服务端恢复、2.5D 组的）时只能尽力：
 * 两个通道不可能把所有夹杂情况都分开，不追究。
 *
 * 用 A 层 `LooseSlots` 的顺序算、不用世界坐标：拖动整组的过程中 A 层不变，分配也就不变，框不会闪。
 */

import type { LooseSlots } from "./loose-reconcile";

export type GroupPass = 0 | 1;

/** groupId → 通道号。没有暗词时是空表 */
export function assignGroupPasses(slots: LooseSlots): Map<number, GroupPass> {
  const first = new Map<number, number>();
  slots.forEach((e, i) => {
    if (e && e.groupId !== undefined && !first.has(e.groupId)) first.set(e.groupId, i);
  });
  const order = [...first.entries()].sort((a, b) => a[1] - b[1]);
  return new Map(order.map(([gid], k) => [gid, (k % 2) as GroupPass]));
}
