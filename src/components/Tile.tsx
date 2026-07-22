/**
 * 一张牌。
 *
 * 牌面传达四件事：
 *   · 字母，红＝元音 / 黑＝辅音（与实体牌一致，RULES.md §1）
 *   · 右上角**小号数字**：字母表序号（a=1…z=26）。纯教学标注，帮学生记字母表位置，
 *     **不是分值**——分值来自张数（稀有度），见 RULES.md §7.1。
 *   · 左下角 **×N**：这个字母全副牌里有几张。张数越少越稀有、越值钱
 *     （8/6 张=1 分，4 张=2 分，2 张=3 分），也帮学生判断还能摸到几张。
 *   · 白搭分元音白搭（红）/ 辅音白搭（黑），各自只能代对应的字母。
 *     一旦声明了它代表哪个字母，牌面上就把那个字母显示出来。
 */

import type { CSSProperties } from "react";

const VOWELS = "aeiou";

export const VOWEL_WILD = "1";
export const CONSONANT_WILD = "2";

/** 全副牌里每个字母有几张（RULES.md §1，按其在英文单词中出现的概率设定） */
export const TILE_COUNTS: Record<string, number> = {
  a: 6, b: 2, c: 4, d: 4, e: 8, f: 4, g: 4, h: 4, i: 8,
  j: 2, k: 2, l: 4, m: 4, n: 6, o: 8, p: 2, q: 2, r: 4,
  s: 4, t: 8, u: 4, v: 2, w: 2, x: 2, y: 2, z: 2,
};

export function isWild(tile: string) {
  return tile === VOWEL_WILD || tile === CONSONANT_WILD;
}

export function isVowelTile(tile: string) {
  return tile === VOWEL_WILD || VOWELS.includes(tile);
}

/** 元音白搭只能代 aeiou，辅音白搭只能代 21 个辅音（只看字母不看读音，故 y 属辅音） */
export function wildCandidates(tile: string): string[] {
  if (tile === VOWEL_WILD) return [...VOWELS];
  if (tile === CONSONANT_WILD) {
    return [..."abcdefghijklmnopqrstuvwxyz"].filter((c) => !VOWELS.includes(c));
  }
  return [];
}

/** 字母表序号：a=1 … z=26 */
function ordinal(tile: string) {
  return tile.charCodeAt(0) - 96;
}

interface Props {
  tile: string;
  /** 白搭已声明代表的字母 —— 牌面上把它显示出来 */
  asLetter?: string;
  selected?: boolean;
  dimmed?: boolean;
  small?: boolean;
  /** 选中的第几张（点选顺序 = 拼词顺序） */
  order?: number;
  onClick?: () => void;
}

export function Tile({ tile, asLetter, selected, dimmed, small, order, onClick }: Props) {
  const wild = isWild(tile);
  const vowel = isVowelTile(tile);
  const shown = wild ? asLetter : tile;

  const cls = [
    "tile",
    vowel ? "tile-vowel" : "tile-consonant",
    wild && "tile-wild-card",
    selected && "tile-selected",
    dimmed && "tile-dimmed",
    small && "tile-small",
    onClick && "tile-clickable",
  ]
    .filter(Boolean)
    .join(" ");

  // 不可点的牌用 <div>，绝不能用 <button disabled>——**disabled 的按钮会吞掉点击**，
  // 于是外层容器的 onClick 永远收不到。已组好的暗词就栽在这上面：整个词是可点的
  // （点一下拆开），但点击总是落在里面某张牌上，被那个 disabled 按钮吃掉，
  // 玩家怎么点都拆不开。
  const inner = (
    <>
      {order !== undefined && <span className="tile-order">{order}</span>}

      {wild ? (
        <>
          <span className="tile-letter">{shown ? shown.toUpperCase() : "★"}</span>
          <span className="tile-wild">{shown ? `★=${shown.toUpperCase()}` : vowel ? "元音" : "辅音"}</span>
        </>
      ) : (
        <>
          <span className="tile-letter">{tile.toUpperCase()}</span>
          {/* 左下：全副牌里的张数（稀有度）；右上：字母表序号（教学标注） */}
          <span className="tile-count">×{TILE_COUNTS[tile] ?? "?"}</span>
          <span className="tile-ordinal">{ordinal(tile)}</span>
        </>
      )}
    </>
  );

  if (!onClick) {
    return <div className={cls}>{inner}</div>;
  }
  return (
    <button className={cls} onClick={onClick} type="button">
      {inner}
    </button>
  );
}

/** 牌背——对手的手牌只显示这个 */
export function TileBack({ small, style }: { small?: boolean; style?: CSSProperties }) {
  return <div className={`tile tile-back ${small ? "tile-small" : ""}`} style={style} />;
}
