/**
 * 一个已成型的单词（亮出的明词、自己组的暗词、结算时摊开的牌）。
 *
 * 牌按**单词的字母顺序**摆——服务端存的是排序后的签名（CAT 存成 "act"），
 * 直接摆出来会是 A-C-T 而底下写着 CAT，看着就是错的。
 * 白搭牌上标出它代表的字母（★=O）。
 */

import { Tile } from "./Tile";
import { orderTiles } from "../wordOrder";

interface Props {
  tiles: string;
  word: string;
  onClick?: () => void;
  label?: string;
}

export function WordTiles({ tiles, word, onClick, label }: Props) {
  const ordered = orderTiles(tiles, word);

  return (
    <div
      className={`word ${onClick ? "word-clickable" : ""}`}
      onClick={onClick}
      title={label}
    >
      <div className="word-tiles">
        {ordered.map((t, i) => (
          <Tile key={i} tile={t.tile} asLetter={t.letter} small />
        ))}
      </div>
      <div className="word-label">{word.toUpperCase()}</div>
    </div>
  );
}
