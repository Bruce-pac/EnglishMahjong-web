import { Quaternion, Vector3 } from "three";

/**
 * 桌面上会动的东西的种类。
 *
 * Autotable 还有 `STICK`（点棒）和 `MARKER`（庄家标记），英语麻将两样都不做
 * （总纲 §8.2）：分数走中央记分盘的 Canvas 纹理，庄家也画在记分盘上。
 * 保留这个 enum 而不是直接写死，是因为 `Size` 和 `Slot.type` 都按它索引。
 */
export enum ThingType {
  TILE = "TILE",
}

/**
 * 牌体尺寸，沿用 Autotable 的 6×9×4（需求文档 §7.1 明确要求对齐）。
 * 正面朝 +Z，比例 2:3 与图集单元格一致，字母才不会被拉伸。
 */
export const Size: Record<ThingType, Vector3> = {
  [ThingType.TILE]: new Vector3(6, 9, 4),
};

/**
 * 一个「摆放姿态」：世界坐标里的位置、朝向，以及该朝向下的轴对齐包围盒尺寸。
 *
 * 由 `Slot.makePlace()` 算出来，同时供三处使用：渲染定位（T1.2）、
 * 鼠标拾取的代理体（T3.1）、拖放落点的重叠面积打分（T3.2）。
 */
export interface Place {
  position: Vector3;
  rotation: Quaternion;
  size: Vector3;
  /**
   * 牌画多大（P6）。自己那排散牌放大到 `HAND_SCALE`（1.21875）倍，其余一律 1。
   * `size` 已经是乘过它的包围盒，渲染那边还要拿它写进实例矩阵的缩放
   */
  scale: number;
}
