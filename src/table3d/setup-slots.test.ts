import { Euler, Quaternion, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  DISCARD_COLS,
  DISCARD_ROWS,
  LOOSE_SLOTS,
  MELD_ROWS,
  meldSlots,
  PLAYERS,
  WALL_SLOTS_TOTAL,
  WALL_TILES,
  WALL_TILES_PER_SEAT,
  WORLD_SIZE,
} from "./layout";
import { makeSlots } from "./setup-slots";
import { Slot } from "./slot";
import { Size, ThingType } from "./types";
import { SEAT_ROTATIONS } from "./utils";

const slots = makeSlots();
const EPSILON = 1e-6;
const TILE = Size[ThingType.TILE];

/** 把一个点绕桌心转 seat×90° —— 测试自己独立算一遍，不复用 Slot.rotate 的实现 */
function rotateAboutCenter(p: Vector3, seat: number): Vector3 {
  const half = WORLD_SIZE / 2;
  const v = new Vector3(p.x - half, p.y - half, p.z).applyQuaternion(SEAT_ROTATIONS[seat]);
  return new Vector3(v.x + half, v.y + half, v.z);
}

describe("槽位名", () => {
  it("全部唯一", () => {
    // makeSlots 内部已经在重名时抛错，这里再从数量上兜一层：
    // Map 的 size 必须等于「按公式算出来的总格数」，少一个就说明有覆盖
    const perSeat =
      LOOSE_SLOTS +
      Array.from({ length: MELD_ROWS }, (_, i) => meldSlots(i)).reduce((a, b) => a + b, 0) +
      DISCARD_ROWS * DISCARD_COLS +
      WALL_SLOTS_TOTAL / PLAYERS;
    expect(slots.size).toBe(perSeat * PLAYERS);
  });

  it("四家都有，且组名齐全", () => {
    for (let seat = 0; seat < PLAYERS; seat++) {
      for (const group of ["loose", "meld", "discard", "wall"]) {
        const mine = [...slots.values()].filter((s) => s.group === group && s.seat === seat);
        expect(mine.length, `${group}@${seat}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("座位旋转", () => {
  it("座位 N 的槽位 = 座位 0 的槽位绕桌心转 N×90°", () => {
    for (let seat = 1; seat < PLAYERS; seat++) {
      for (const [name, slot] of slots) {
        if (!name.endsWith(`@${seat}`)) continue;
        const base = slots.get(name.replace(/@\d+$/, "@0"))!;
        const expected = rotateAboutCenter(base.origin, seat);
        expect(slot.origin.x).toBeCloseTo(expected.x, 6);
        expect(slot.origin.y).toBeCloseTo(expected.y, 6);
        expect(slot.origin.z).toBeCloseTo(expected.z, 6);
      }
    }
  });

  it("连转四次回到原位——round3 挡住了浮点漂移", () => {
    // 不用 toBeCloseTo：要的就是**逐位相等**。量化没生效的话这里会差 1e-16 而挂掉
    const origin = new Vector3(37, 11, 0);
    const slot = new Slot({
      name: "t",
      group: "t",
      origin: origin.clone(),
      rotations: [new Quaternion()],
    });
    for (let i = 0; i < 4; i++) {
      slot.rotate(1, WORLD_SIZE);
    }
    expect(slot.origin.x).toBe(origin.x);
    expect(slot.origin.y).toBe(origin.y);
    expect(slot.origin.z).toBe(origin.z);
  });

  it("direction 转过之后仍是 ±1 的整数，没有 0.9999", () => {
    for (const slot of slots.values()) {
      for (const v of [slot.direction.x, slot.direction.y]) {
        expect(Math.abs(v)).toBe(1);
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
});

describe("makePlace 的包围盒", () => {
  const mk = (rotation: Quaternion) =>
    new Slot({
      name: "t",
      group: "t",
      origin: new Vector3(0, 0, 0),
      rotations: [rotation],
    }).places[0];

  it("正面朝上：包围盒就是牌本身 6×9×4", () => {
    const p = mk(new Quaternion().setFromEuler(new Euler(0, 0, 0)));
    expect(p.size.x).toBeCloseTo(TILE.x);
    expect(p.size.y).toBeCloseTo(TILE.y);
    expect(p.size.z).toBeCloseTo(TILE.z);
    // origin 是包围盒的角，position 是中心
    expect(p.position.x).toBeCloseTo(TILE.x / 2);
    expect(p.position.y).toBeCloseTo(TILE.y / 2);
    expect(p.position.z).toBeCloseTo(TILE.z / 2);
  });

  it("背面朝上：翻面不改变包围盒尺寸", () => {
    const p = mk(new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0)));
    expect(p.size.x).toBeCloseTo(TILE.x);
    expect(p.size.y).toBeCloseTo(TILE.y);
    expect(p.size.z).toBeCloseTo(TILE.z);
  });

  it("侧放（绕 z 转 90°）：x 与 y 互换", () => {
    const p = mk(new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2)));
    expect(p.size.x).toBeCloseTo(TILE.y);
    expect(p.size.y).toBeCloseTo(TILE.x);
    expect(p.size.z).toBeCloseTo(TILE.z);
  });

  it("立起来（绕 x 转 90°）：y 与 z 互换", () => {
    const p = mk(new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)));
    expect(p.size.x).toBeCloseTo(TILE.x);
    expect(p.size.y).toBeCloseTo(TILE.z);
    expect(p.size.z).toBeCloseTo(TILE.y);
  });

  it("direction = -1 时牌往反方向长", () => {
    const s = new Slot({
      name: "t",
      group: "t",
      origin: new Vector3(WORLD_SIZE, 0, 0),
      direction: new Vector2(-1, 1),
      rotations: [new Quaternion()],
    });
    expect(s.places[0].position.x).toBeCloseTo(WORLD_SIZE - TILE.x / 2);
  });
});

describe("散牌区", () => {
  const loose0 = [...slots.values()]
    .filter((s) => s.group === "loose" && s.seat === 0)
    .sort((a, b) => a.indexes[0] - b.indexes[0]);

  it("放得下庄家的 14 张，还有腾挪余量", () => {
    // 手牌上限就是 DEALER_HAND_SIZE=14（rules.py），实测 3000 局峰值恰好 14
    expect(loose0.length).toBe(LOOSE_SLOTS);
    expect(loose0.length).toBeGreaterThanOrEqual(14);
    expect(loose0.length).toBeGreaterThan(14); // 余量是 shiftLeft/shiftRight 挤牌用的
  });

  it("整排在桌面之内且居中", () => {
    const first = loose0[0].places[0];
    const last = loose0[loose0.length - 1].places[0];
    expect(first.position.x - first.size.x / 2).toBeGreaterThanOrEqual(0);
    expect(last.position.x + last.size.x / 2).toBeLessThanOrEqual(WORLD_SIZE);
    // 首尾中点应当落在桌心的 x 上
    expect((first.position.x + last.position.x) / 2).toBeCloseTo(WORLD_SIZE / 2);
  });

  it("shift 链把一排从头串到尾，且左右互为逆", () => {
    expect(loose0[0].links.shiftLeft).toBeUndefined();
    expect(loose0[loose0.length - 1].links.shiftRight).toBeUndefined();
    let n = 1;
    let cur = loose0[0];
    while (cur.links.shiftRight) {
      const next = cur.links.shiftRight;
      expect(next.links.shiftLeft).toBe(cur);
      cur = next;
      n++;
    }
    expect(n).toBe(LOOSE_SLOTS);
  });

  it("相邻两格正好差一个牌宽，不重叠也不留缝", () => {
    for (let i = 1; i < loose0.length; i++) {
      expect(loose0[i].origin.x - loose0[i - 1].origin.x).toBeCloseTo(TILE.x);
    }
  });
});

describe("亮词区", () => {
  it("行数 = max_melds() 的最大值 4，第 i 行 14-3i 格", () => {
    expect(MELD_ROWS).toBe(4);
    for (let r = 0; r < MELD_ROWS; r++) {
      const inRow = [...slots.values()].filter(
        (s) => s.group === "meld" && s.seat === 0 && s.indexes[0] === r,
      );
      expect(inRow.length, `第 ${r} 行`).toBe(meldSlots(r));
    }
    expect([0, 1, 2, 3].map(meldSlots)).toEqual([14, 11, 8, 5]);
  });

  it("靠右生长，整体不出桌面", () => {
    for (const s of slots.values()) {
      if (s.group !== "meld" || s.seat !== 0) continue;
      const p = s.places[0];
      expect(p.position.x - p.size.x / 2).toBeGreaterThanOrEqual(0);
      expect(p.position.x + p.size.x / 2).toBeLessThanOrEqual(WORLD_SIZE);
    }
  });

  it("永久冻结，不参与重排——没有 shift 链", () => {
    for (const s of slots.values()) {
      if (s.group !== "meld") continue;
      expect(s.links.shiftLeft).toBeUndefined();
      expect(s.links.shiftRight).toBeUndefined();
    }
  });
});

describe("牌河", () => {
  it("每家一片，3×9 = 27 格", () => {
    for (let seat = 0; seat < PLAYERS; seat++) {
      const mine = [...slots.values()].filter((s) => s.group === "discard" && s.seat === seat);
      expect(mine.length).toBe(DISCARD_ROWS * DISCARD_COLS);
    }
  });

  it("容得下实测峰值 21 张", () => {
    expect(DISCARD_ROWS * DISCARD_COLS).toBeGreaterThanOrEqual(21);
  });
});

describe("牌墙", () => {
  it("摆得下开局的 56 张（108 - 4×13），每家 14 张", () => {
    expect(WALL_TILES).toBe(108 - PLAYERS * 13);
    expect(WALL_TILES_PER_SEAT).toBe(14);
    expect([...slots.values()].filter((s) => s.group === "wall").length).toBe(WALL_SLOTS_TOTAL);
    expect(WALL_SLOTS_TOTAL).toBeGreaterThanOrEqual(WALL_TILES);
    for (let seat = 0; seat < PLAYERS; seat++) {
      const mine = [...slots.values()].filter((s) => s.group === "wall" && s.seat === seat);
      expect(mine.length).toBeGreaterThanOrEqual(WALL_TILES_PER_SEAT);
    }
  });

  it("不可交互：只有背面一种朝向，不画影子", () => {
    for (const s of slots.values()) {
      if (s.group !== "wall") continue;
      expect(s.rotations.length).toBe(1);
      expect(s.drawShadow).toBe(false);
      expect(s.rotateHeld).toBe(false);
    }
  });
});

describe("四个区互不重叠", () => {
  /** 两个格子的默认姿态在 xy 平面上是否相交（贴边不算） */
  function overlaps(a: Slot, b: Slot): boolean {
    const pa = a.places[0];
    const pb = b.places[0];
    const dx = Math.abs(pa.position.x - pb.position.x) < (pa.size.x + pb.size.x) / 2 - EPSILON;
    const dy = Math.abs(pa.position.y - pb.position.y) < (pa.size.y + pb.size.y) / 2 - EPSILON;
    return dx && dy;
  }

  it("**四家之间**也不重叠——牌河要拼成风车，不能在桌心撞成一团", () => {
    // 这一条是画布局图时发现漏掉的：只测同一家的话，四家的牌河在中央
    // 叠成一坨都测不出来，中央记分盘（D12）也就没地方放了
    const all = [...slots.values()];
    const bad: string[] = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (all[i].seat === all[j].seat) continue;
        if (overlaps(all[i], all[j])) bad.push(`${all[i].name} × ${all[j].name}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("桌心留出 54×54 的空地给记分盘", () => {
    const lo = (WORLD_SIZE - 54) / 2;
    const hi = WORLD_SIZE - lo;
    for (const s of slots.values()) {
      const p = s.places[0];
      const insideX = p.position.x - p.size.x / 2 > lo + EPSILON && p.position.x + p.size.x / 2 < hi - EPSILON;
      const insideY = p.position.y - p.size.y / 2 > lo + EPSILON && p.position.y + p.size.y / 2 < hi - EPSILON;
      expect(insideX && insideY, `${s.name} 占了桌心`).toBe(false);
    }
  });

  it("同一家的任意两格，包围盒在 xy 平面上不相交", () => {
    const mine = [...slots.values()].filter((s) => s.seat === 0);
    // 只比默认朝向（places[0]）——那是牌实际停放的姿态
    const boxes = mine.map((s) => ({ name: s.name, p: s.places[0] }));
    const EPS = 1e-6;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].p;
        const b = boxes[j].p;
        const overlapX = Math.abs(a.position.x - b.position.x) < (a.size.x + b.size.x) / 2 - EPS;
        const overlapY = Math.abs(a.position.y - b.position.y) < (a.size.y + b.size.y) / 2 - EPS;
        expect(overlapX && overlapY, `${boxes[i].name} 与 ${boxes[j].name} 重叠`).toBe(false);
      }
    }
  });

  it("所有格子都在桌面之内", () => {
    for (const s of slots.values()) {
      const p = s.places[0];
      expect(p.position.x - p.size.x / 2).toBeGreaterThanOrEqual(-EPSILON);
      expect(p.position.y - p.size.y / 2).toBeGreaterThanOrEqual(-EPSILON);
      expect(p.position.x + p.size.x / 2).toBeLessThanOrEqual(WORLD_SIZE + EPSILON);
      expect(p.position.y + p.size.y / 2).toBeLessThanOrEqual(WORLD_SIZE + EPSILON);
    }
  });
});
