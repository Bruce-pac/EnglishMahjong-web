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

/**
 * 两个轴对齐矩形（中心 + 宽高）的重叠面积。拖放落点打分用（研究笔记第四章（中））
 */
export function rectangleOverlap(
  x1: number,
  y1: number,
  w1: number,
  h1: number,
  x2: number,
  y2: number,
  w2: number,
  h2: number,
): number {
  const xa = Math.max(x1 - w1 / 2, x2 - w2 / 2);
  const xb = Math.min(x1 + w1 / 2, x2 + w2 / 2);
  const ya = Math.max(y1 - h1 / 2, y2 - h2 / 2);
  const yb = Math.min(y1 + h1 / 2, y2 + h2 / 2);
  return Math.max(0, xb - xa) * Math.max(0, yb - ya);
}

/**
 * 一个 0..1（或 -1..1）之间的缓动量。
 *
 * 相机的三个连续参数（低头、缩放）都由它驱动：按下键 `start(1)`、松开 `start(0)`，
 * 中间自己走完 150ms。**不要做成瞬切**——相机瞬间跳位置很晕，而且看不出是自己按的。
 *
 * `period` 是**走完整段 1.0 的时间**，不是固定时长：从 0.8 回到 0 只花 0.2×period。
 * 这样连按不会越走越慢。
 */
export class Animation {
  private startTime = 0;
  private endTime = 1;
  private startPos = 0;
  private endPos = 0;
  private readonly period: number;

  pos = 0;

  constructor(period: number) {
    this.period = period;
  }

  start(endPos: number): void {
    this.startPos = this.pos;
    this.startTime = performance.now();
    this.endPos = endPos;
    this.endTime = this.startTime + this.period * Math.abs(endPos - this.pos);
  }

  /** 推进一帧。返回是否还在动（false = 已经到位，可以省掉后续计算） */
  update(): boolean {
    if (this.pos === this.endPos) {
      return false;
    }
    const delta = (performance.now() - this.startTime) / (this.endTime - this.startTime);
    this.pos = this.startPos + (this.endPos - this.startPos) * Math.min(1, delta);
    return true;
  }
}
