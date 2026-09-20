import { Euler, Quaternion, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  DISCARD_COLS,
  DISCARD_ROWS,
  LOOSE_SLOTS,
  LOOSE_SPARE_EACH_SIDE,
  MELD_ROWS,
  meldSlots,
  PLAYERS,
  WALL_LAYERS,
  WALL_SLOTS_TOTAL,
  WALL_STACKS_OTHER,
  WALL_STACKS_PLAYER,
  wallStacks,
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
    // 牌墙四家不一样长（玩家侧 15 墩、别家 13 墩），所以逐家累加
    const perSeatCommon =
      LOOSE_SLOTS +
      Array.from({ length: MELD_ROWS }, (_, i) => meldSlots(i)).reduce((a, b) => a + b, 0) +
      DISCARD_ROWS * DISCARD_COLS;
    let want = 0;
    for (let seat = 0; seat < PLAYERS; seat++) {
      want += perSeatCommon + wallStacks(seat) * WALL_LAYERS;
    }
    expect(slots.size).toBe(want);
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
        // 牌墙是唯一的例外：玩家侧 15 墩、别家 13 墩，长度不同也就没有共同的原型。
        // 别家三堵墙之间仍然是严格的旋转关系，拿座位 1 当基准比。
        const baseSeat = slot.group === "wall" ? 1 : 0;
        if (seat === baseSeat) continue;
        const base = slots.get(name.replace(/@\d+$/, `@${baseSeat}`))!;
        const expected = rotateAboutCenter(base.origin, seat - baseSeat);
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
  it("两种朝向：自己平放正面朝上，别家立着（牌面朝他自己）", () => {
    const slot = slots.get("loose.0@0")!;
    expect(slot.rotations.length).toBe(2);
    // 平放：包围盒就是牌本身 6×9×4
    expect(slot.places[0].size.y).toBeCloseTo(TILE.y);
    expect(slot.places[0].size.z).toBeCloseTo(TILE.z);
    // 立着：y 与 z 互换，占地变浅、变高
    expect(slot.places[1].size.y).toBeCloseTo(TILE.z);
    expect(slot.places[1].size.z).toBeCloseTo(TILE.y);
    // 立着的牌坐在桌面上，不悬空、不陷进桌子
    expect(slot.places[1].position.z).toBeCloseTo(TILE.y / 2);
  });

  const loose0 = [...slots.values()]
    .filter((s) => s.group === "loose" && s.seat === 0)
    .sort((a, b) => a.indexes[0] - b.indexes[0]);

  it("放得下庄家的 14 张，还有腾挪余量", () => {
    // 手牌上限就是 DEALER_HAND_SIZE=14（rules.py），实测 3000 局峰值恰好 14
    expect(loose0.length).toBe(LOOSE_SLOTS);
    expect(loose0.length).toBeGreaterThanOrEqual(14);
    expect(loose0.length).toBeGreaterThan(14); // 余量是 shiftLeft/shiftRight 挤牌用的
  });

  it("整排在桌面之内且居中，腾挪余量左右各 2 格", () => {
    const first = loose0[0].places[0];
    const last = loose0[loose0.length - 1].places[0];
    expect(first.position.x - first.size.x / 2).toBeGreaterThanOrEqual(0);
    expect(last.position.x + last.size.x / 2).toBeLessThanOrEqual(WORLD_SIZE);
    // 整排 18 格居中
    expect((first.position.x + last.position.x) / 2).toBeCloseTo(WORLD_SIZE / 2);

    // 于是满手 14 张（下标 2..15）也正好居中——初始铺牌居中由 rebuildLoose 保证，
    // 这里验的是「格子本身对称」这个前提
    const held = loose0.slice(LOOSE_SPARE_EACH_SIDE, LOOSE_SPARE_EACH_SIDE + 14);
    expect(held.length).toBe(14);
    expect(
      (held[0].places[0].position.x + held[13].places[0].position.x) / 2,
    ).toBeCloseTo(WORLD_SIZE / 2);
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

  it("右对齐、尽量塞进右下角", () => {
    // 每行最后一格（= 单词的最后一个字母）落在同一条右边线上
    const rowEnd = (r: number) => slots.get(`meld.${r}.${meldSlots(r) - 1}@0`)!.places[0];
    for (let r = 1; r < MELD_ROWS; r++) {
      expect(rowEnd(r).position.x).toBeCloseTo(rowEnd(0).position.x);
    }
    // 下标 0 是最左边那格：单词才会从左往右读，而不是倒着摆
    for (let r = 0; r < MELD_ROWS; r++) {
      const first = slots.get(`meld.${r}.0@0`)!.places[0];
      expect(first.position.x, `第 ${r} 行`).toBeLessThan(rowEnd(r).position.x);
    }
    const rowStart = rowEnd;
    // 在桌子的右半边（需求文档 §3：亮词区在右下角）
    expect(rowStart(0).position.x).toBeGreaterThan(WORLD_SIZE / 2);
    // 贴着桌沿（§3「右下角」）。转 90° 之后会不会压到下家，由「四家之间不重叠」
    // 那条按格子逐一验——不是靠在这里留一个牌高的余量猜
    const right = rowStart(0).position.x + rowStart(0).size.x / 2;
    expect(WORLD_SIZE - right).toBeLessThanOrEqual(TILE.x);

    // 也尽量贴近桌沿那一侧：首行紧挨着散牌区，再往角落挪就压上散牌区了
    const firstRowNear = slots.get("meld.0.0@0")!.places[0];
    const hand = slots.get("loose.0@0")!.places[0];
    expect(firstRowNear.position.y - firstRowNear.size.y / 2).toBeCloseTo(
      hand.position.y + hand.size.y / 2,
    );

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
  it("第 0 行贴着桌心，往外长——真牌桌就是这么打的", () => {
    const rows = [0, 1, 2].map((r) => slots.get(`discard.${r}.0@0`)!.places[0].position.y);
    // 行号越大离桌心越远
    expect(rows[0]).toBeGreaterThan(rows[1]);
    expect(rows[1]).toBeGreaterThan(rows[2]);
    // 第 0 行的内侧边正好贴着中央空地
    const inner = slots.get("discard.0.0@0")!.places[0];
    expect(inner.position.y + inner.size.y / 2).toBeCloseTo((WORLD_SIZE - DISCARD_COLS * TILE.x) / 2);
  });

  it("每家一片，4×7 = 28 格", () => {
    for (let seat = 0; seat < PLAYERS; seat++) {
      const mine = [...slots.values()].filter((s) => s.group === "discard" && s.seat === seat);
      expect(mine.length).toBe(DISCARD_ROWS * DISCARD_COLS);
      expect(DISCARD_ROWS * DISCARD_COLS).toBe(28);
    }
  });

  it("容得下实测峰值 21 张", () => {
    expect(DISCARD_ROWS * DISCARD_COLS).toBeGreaterThanOrEqual(21);
  });
});

describe("牌墙", () => {
  it("与手牌之间留出空当——贴在一起就不是牌桌了", () => {
    const hand = slots.get("loose.0@0")!.places[0];
    const wall = slots.get("wall.0.0@0")!.places[0];
    const gap = wall.position.y - wall.size.y / 2 - (hand.position.y + hand.size.y / 2);
    expect(gap).toBeGreaterThanOrEqual(TILE.y); // 至少一个牌高
  });

  it("槽位数正好是一副牌：15×2 + 13×2×3 = 108，零余量", () => {
    expect(WALL_SLOTS_TOTAL).toBe(108);
    expect([...slots.values()].filter((s) => s.group === "wall").length).toBe(WALL_SLOTS_TOTAL);
    for (let seat = 0; seat < PLAYERS; seat++) {
      const mine = [...slots.values()].filter((s) => s.group === "wall" && s.seat === seat);
      expect(mine.length, `座位 ${seat}`).toBe(wallStacks(seat) * WALL_LAYERS);
    }
    // 半墩（1 张）不好看，四个半墩凑成的 2 墩塞进玩家那一侧
    expect(WALL_STACKS_PLAYER - WALL_STACKS_OTHER).toBe(2);
  });

  it("每墩两层，上层正好压在下层上面", () => {
    for (let stack = 0; stack < WALL_STACKS_PLAYER; stack++) {
      const lower = slots.get(`wall.${stack}.0@0`)!;
      const upper = slots.get(`wall.${stack}.1@0`)!;
      expect(upper.origin.x).toBe(lower.origin.x);
      expect(upper.origin.y).toBe(lower.origin.y);
      expect(upper.origin.z - lower.origin.z).toBeCloseTo(TILE.z);
    }
  });

  it("不可交互：只有背面一种朝向，不接拖放", () => {
    for (const s of slots.values()) {
      if (s.group !== "wall") continue;
      expect(s.rotations.length).toBe(1);
      expect(s.rotateHeld).toBe(false);
    }
  });

  it("影子只画下层——一墩两层在 xy 上完全重合，画两块会加倍变黑", () => {
    for (const s of slots.values()) {
      if (s.group !== "wall") continue;
      const layer = s.indexes[s.indexes.length - 1];
      expect(s.drawShadow, s.name).toBe(layer === 0);
    }
  });
});

describe("槽位影子", () => {
  it("散牌区 / 牌河 / 牌墙画影子，亮词区不画，且总数没顶到 ObjectView 的上限", () => {
    const withShadow = [...slots.values()].filter((s) => s.drawShadow);
    for (const group of ["loose", "discard", "wall"]) {
      expect(withShadow.some((s) => s.group === group), group).toBe(true);
    }
    // 亮词区不接收拖放，影子只会让开局四个角发暗（P7）
    expect(withShadow.some((s) => s.group === "meld")).toBe(false);
    // object-view.ts 的 MAX_SHADOWS 是 512，算式写在那儿
    expect(withShadow.length).toBe(72 + 112 + 54);
    expect(withShadow.length).toBeLessThanOrEqual(512);
  });
});

describe("四个区互不重叠", () => {
  /**
   * 两个格子的默认姿态是否相交（贴边不算）。
   *
   * **必须连 z 一起判**：牌墙一墩两层，两层在 xy 上完全重合，靠 z 分开——
   * 只判 xy 的话每一墩都会被当成「自己压自己」。
   */
  function overlaps(a: Slot, b: Slot): boolean {
    const pa = a.places[0];
    const pb = b.places[0];
    const dx = Math.abs(pa.position.x - pb.position.x) < (pa.size.x + pb.size.x) / 2 - EPSILON;
    const dy = Math.abs(pa.position.y - pb.position.y) < (pa.size.y + pb.size.y) / 2 - EPSILON;
    const dz = Math.abs(pa.position.z - pb.position.z) < (pa.size.z + pb.size.z) / 2 - EPSILON;
    return dx && dy && dz;
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

  it("桌心留出的空地边长 = 牌河宽度，四片牌河才能拼成风车", () => {
    const lo = (WORLD_SIZE - DISCARD_COLS * TILE.x) / 2;
    const hi = WORLD_SIZE - lo;
    for (const s of slots.values()) {
      const p = s.places[0];
      const insideX = p.position.x - p.size.x / 2 > lo + EPSILON && p.position.x + p.size.x / 2 < hi - EPSILON;
      const insideY = p.position.y - p.size.y / 2 > lo + EPSILON && p.position.y + p.size.y / 2 < hi - EPSILON;
      expect(insideX && insideY, `${s.name} 占了桌心`).toBe(false);
    }
  });

  it("同一家的任意两格，包围盒不相交（牌墙两层靠 z 分开）", () => {
    const mine = [...slots.values()].filter((s) => s.seat === 0);
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        expect(overlaps(mine[i], mine[j]), `${mine[i].name} 与 ${mine[j].name} 重叠`).toBe(false);
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
