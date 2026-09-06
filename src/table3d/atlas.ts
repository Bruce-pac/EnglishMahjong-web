/**
 * 图集契约（需求文档 §7.1）——**与着色器、`art/build_tiles_svg.py`、
 * `art/make_model.py` 是同一份约定，改任何一处都要三处同步改。**
 *
 * ```
 * 12 列 × 12 行，单元格 32×48（比例 2:3，与牌面 6×9 一致，字母才不被拉伸）
 * 图集 384×576，TILE_DU = 32/384 = 1/12，TILE_DV = 48/576 = 1/12
 *
 * 第 0-8 行    106 个牌面（108 格，末尾 2 格填底色）
 * 第 9 行      侧面色板（整行纯色）
 * 第 10-11 行  牌背（两个深浅变体）
 * ```
 *
 * 实际 PNG 按 SCALE=4 超采样导出成 1536×2304，每格 128×192 像素。
 * **UV 是比例、像素是清晰度**，改 SCALE 不影响这里的常量。
 */

export const ATLAS_COLS = 12;
export const TILE_DU = 1 / 12;
export const TILE_DV = 1 / 12;

/** 牌背区起始行。着色器用 `v >= BACK_ROW * TILE_DV` 判定牌背 */
export const BACK_ROW = 10;
/** 牌背的深浅变体数（第 10、11 行） */
export const BACK_VARIANTS = 2;

/**
 * 牌面总数。编号顺序是前后端约定，**不能改**：
 *
 * ```
 *   0.. 25   A..Z 大写
 *  26.. 51   a..z 小写
 *  52        元音白搭，未声明
 *  53        辅音白搭，未声明
 *  54.. 58   元音白搭声明为 A E I O U
 *  59.. 63   元音白搭声明为 a e i o u
 *  64.. 84   辅音白搭声明为 21 个辅音（大写）
 *  85..105   辅音白搭声明为 21 个辅音（小写）
 * ```
 */
export const FACE_COUNT = 106;

const VOWELS = "aeiou";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const CONSONANTS = [...ALPHABET].filter((c) => !VOWELS.includes(c)).join("");

/** 元音白搭（`rules.py` 里内部字符是 `"1"`）未声明时的牌面编号 */
export const WILD_VOWEL = 52;
/** 辅音白搭（内部字符 `"2"`）未声明时的牌面编号 */
export const WILD_CONSONANT = 53;

/**
 * 普通字母牌的牌面编号。
 * `letter` 传 a-z 或 A-Z，`lower` 决定用大写段还是小写段（纯显示，见需求文档 §4.9）。
 */
export function letterFace(letter: string, lower = false): number {
  const i = ALPHABET.indexOf(letter.toLowerCase());
  if (i < 0) throw new Error(`不是字母：${letter}`);
  return (lower ? 26 : 0) + i;
}

/**
 * 已声明的白搭牌面编号。
 * `kind` 是白搭种类（`"1"` 元音 / `"2"` 辅音），`letter` 是玩家声明代替的字母。
 * 白搭只能代替本类字母（RULES §1），传错要当场炸，不能静默画成别的牌。
 */
export function wildFace(kind: "1" | "2", letter: string, lower = false): number {
  const lc = letter.toLowerCase();
  if (kind === "1") {
    const i = VOWELS.indexOf(lc);
    if (i < 0) throw new Error(`元音白搭不能代替 ${letter}`);
    return 54 + (lower ? 5 : 0) + i;
  }
  const i = CONSONANTS.indexOf(lc);
  if (i < 0) throw new Error(`辅音白搭不能代替 ${letter}`);
  return 64 + (lower ? 21 : 0) + i;
}

/**
 * 牌面编号 → 图集格子的 UV 偏移。
 *
 * 返回值直接写进 instance 的 `offset` 属性：
 * - `x` / `y`：正面要加的偏移（把左上角那格挪到 typeIndex 对应的格子）
 * - `z`：牌背要加的 v 偏移（选第几个深浅变体）
 *
 * 模型的 UV 里，正面本来就落在左上角第 0 格、牌背落在第 10 行第 0 格，
 * 所以偏移是「相对第 0 格」的增量，不是绝对坐标。
 */
export function faceOffset(typeIndex: number, backVariant = 0): [number, number, number] {
  const i = typeIndex % FACE_COUNT;
  return [
    (i % ATLAS_COLS) * TILE_DU,
    Math.floor(i / ATLAS_COLS) * TILE_DV,
    (backVariant % BACK_VARIANTS) * TILE_DV,
  ];
}
