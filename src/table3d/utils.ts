import { Quaternion, Vector3 } from "three";

/**
 * 四个座位的朝向：绕 Z 轴每家转 90°。
 * 布局只为 0 号座位定义一次，其余三家靠 `Slot.rotate()` 复制（需求文档 §3）。
 */
export const SEAT_ROTATIONS = [
  new Quaternion(),
  new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1 * (Math.PI / 2)),
  new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 2 * (Math.PI / 2)),
  new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 3 * (Math.PI / 2)),
];

/**
 * 把坐标量化到 1/factor。
 *
 * 旋转 90° 本该是精确的，但四元数走的是浮点，转四次回不到原点（差 1e-16 量级）。
 * 槽位坐标一旦漂移，「哪张牌在左边」这类判断就可能翻转——而框选推导单词正是
 * 靠左右顺序（需求文档 §10 第 1 条）。量化把漂移直接抹掉。
 */
export function round3(vec: Vector3, factor: number): void {
  vec.x = Math.round(vec.x * factor) / factor;
  vec.y = Math.round(vec.y * factor) / factor;
  vec.z = Math.round(vec.z * factor) / factor;
}
