/** T2.3d：角色摆位（纯函数）与「行动方 → 前倾」 */

import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { characterMatrix, headAnchor, leaningSeats } from "./characters";
import { WORLD_SIZE } from "./layout";

const center = new Vector3(WORLD_SIZE / 2, WORLD_SIZE / 2, 0);
const feet = (seat: number) => new Vector3().setFromMatrixPosition(characterMatrix(seat));
/** 模型空间的方向（glTF：+Z 正面、+Y 上）变换到世界 */
const dir = (seat: number, v: Vector3, lean = 0) => v.clone().transformDirection(characterMatrix(seat, lean));

describe("摆位", () => {
  it("脚底落在桌子外侧对应的那条边", () => {
    expect(feet(1).x).toBeGreaterThan(WORLD_SIZE);
    expect(feet(2).y).toBeGreaterThan(WORLD_SIZE);
    expect(feet(3).x).toBeLessThan(0);
    for (const s of [1, 2, 3]) expect(Math.abs(feet(s).z)).toBeLessThan(1e-6);
  });

  it("正面朝向桌心（夹角 < 5°），上方向是世界 +Z", () => {
    for (const s of [1, 2, 3]) {
      const toCenter = center.clone().sub(feet(s)).normalize();
      const front = dir(s, new Vector3(0, 0, 1));
      expect((front.angleTo(toCenter) * 180) / Math.PI).toBeLessThan(5);
      expect(dir(s, new Vector3(0, 1, 0)).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6);
    }
  });

  it("前倾是朝桌心低头：头的方向往桌心偏", () => {
    const up = dir(2, new Vector3(0, 1, 0), (8 * Math.PI) / 180);
    const toCenter = center.clone().sub(feet(2)).normalize();
    expect(up.dot(toCenter)).toBeGreaterThan(0.1);
    expect(up.z).toBeGreaterThan(0.98);
  });

  it("气泡锚点在角色头顶上方", () => {
    const h = headAnchor(1);
    expect(h.x).toBeCloseTo(feet(1).x);
    expect(h.z).toBeGreaterThan(50);
  });
});

describe("行动方 → 前倾", () => {
  it("actorOf 给 2 时只有座位 2 前倾；给 0 / null 时谁都不前倾", () => {
    expect(leaningSeats(2)).toEqual([2]);
    expect(leaningSeats(0)).toEqual([]);
    expect(leaningSeats(null)).toEqual([]);
  });
});
