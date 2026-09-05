import { describe, expect, it } from "vitest";
import {
  ATLAS_COLS,
  BACK_ROW,
  faceOffset,
  FACE_COUNT,
  letterFace,
  TILE_DU,
  TILE_DV,
  WILD_CONSONANT,
  WILD_VOWEL,
  wildFace,
} from "./atlas";

describe("图集契约（需求文档 §7.1）", () => {
  it("12 列 12 行，DU = DV = 1/12", () => {
    expect(ATLAS_COLS).toBe(12);
    expect(TILE_DU).toBe(1 / 12);
    expect(TILE_DV).toBe(1 / 12);
    // 牌背从第 10 行起——着色器的判定阈值就是这个
    expect(BACK_ROW).toBe(10);
  });

  it("牌面 106 个，放得进第 0-8 行的 108 格", () => {
    expect(FACE_COUNT).toBe(106);
    expect(FACE_COUNT).toBeLessThanOrEqual(9 * ATLAS_COLS);
  });

  it("侧面色板（第 9 行）既不落在正面区也不落在牌背区", () => {
    // art/make_model.py 把侧面 UV 硬定在 (0.5, 9.5*DV)。
    // 落进任何一个区都会跟着 typeIndex 偏移、采到别的字母
    const u = 0.5;
    const v = 9.5 * TILE_DV;
    expect(u <= TILE_DU && v <= TILE_DV).toBe(false); // 不是正面
    expect(v >= BACK_ROW * TILE_DV).toBe(false); // 不是牌背
  });
});

describe("牌面编号表（前后端约定，顺序不能改）", () => {
  it("0..25 是 A..Z 大写，26..51 是 a..z 小写", () => {
    expect(letterFace("A")).toBe(0);
    expect(letterFace("Z")).toBe(25);
    expect(letterFace("a", true)).toBe(26);
    expect(letterFace("z", true)).toBe(51);
    // 大小写只是显示开关（§4.5），传进来的字母本身不区分大小写
    expect(letterFace("a")).toBe(letterFace("A"));
  });

  it("52 / 53 是未声明的元音 / 辅音白搭", () => {
    expect(WILD_VOWEL).toBe(52);
    expect(WILD_CONSONANT).toBe(53);
  });

  it("54..63 是声明过的元音白搭（大写 5 个 + 小写 5 个）", () => {
    expect(wildFace("1", "A")).toBe(54);
    expect(wildFace("1", "U")).toBe(58);
    expect(wildFace("1", "a", true)).toBe(59);
    expect(wildFace("1", "u", true)).toBe(63);
  });

  it("64..105 是声明过的辅音白搭（21 个 × 大小写）", () => {
    expect(wildFace("2", "B")).toBe(64);
    expect(wildFace("2", "b", true)).toBe(85);
    // y 属辅音（RULES §1），是 21 个辅音里的最后一个
    expect(wildFace("2", "z")).toBe(84);
    expect(wildFace("2", "z", true)).toBe(105);
    expect(FACE_COUNT).toBe(106);
  });

  it("白搭不能代替另一类的字母——要当场炸，不能静默画错牌", () => {
    expect(() => wildFace("1", "b")).toThrow(/元音白搭/);
    expect(() => wildFace("2", "a")).toThrow(/辅音白搭/);
    expect(() => letterFace("1")).toThrow(/不是字母/);
  });

  it("106 个编号两两不重复，且全部落在 0..105", () => {
    const all = new Set<number>();
    for (const c of "abcdefghijklmnopqrstuvwxyz") {
      all.add(letterFace(c));
      all.add(letterFace(c, true));
    }
    all.add(WILD_VOWEL);
    all.add(WILD_CONSONANT);
    for (const c of "aeiou") {
      all.add(wildFace("1", c));
      all.add(wildFace("1", c, true));
    }
    for (const c of "bcdfghjklmnpqrstvwxyz") {
      all.add(wildFace("2", c));
      all.add(wildFace("2", c, true));
    }
    expect(all.size).toBe(FACE_COUNT);
    expect(Math.min(...all)).toBe(0);
    expect(Math.max(...all)).toBe(FACE_COUNT - 1);
  });
});

describe("faceOffset", () => {
  it("typeIndex -> (col, row) = (i % 12, i / 12)", () => {
    expect(faceOffset(0)).toEqual([0, 0, 0]);
    expect(faceOffset(11)).toEqual([11 * TILE_DU, 0, 0]);
    expect(faceOffset(12)).toEqual([0, TILE_DV, 0]);
    expect(faceOffset(105)).toEqual([(105 % 12) * TILE_DU, Math.floor(105 / 12) * TILE_DV, 0]);
  });

  it("每个牌面的偏移都把正面推进第 0-8 行，不会越进侧面色板", () => {
    for (let i = 0; i < FACE_COUNT; i++) {
      const [, dy] = faceOffset(i);
      // 正面本来落在第 0 格（v ∈ [0, DV]），加上 dy 之后最远到第 8 行的底
      expect(dy + TILE_DV).toBeLessThanOrEqual(9 * TILE_DV + 1e-9);
    }
  });

  it("牌背变体只动 v，且落在第 10、11 行", () => {
    expect(faceOffset(0, 0)[2]).toBe(0);
    expect(faceOffset(0, 1)[2]).toBe(TILE_DV);
    // 牌背本来落在第 10 行，加 1 格到第 11 行，不会越出图集
    expect(BACK_ROW * TILE_DV + faceOffset(0, 1)[2] + TILE_DV).toBeLessThanOrEqual(1 + 1e-9);
  });
});
