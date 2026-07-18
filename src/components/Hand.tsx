/**
 * 我的手牌 —— 整个界面的灵魂。
 *
 * 手牌分两区，跟实体牌桌一样（用户最初的原话）：
 *   「将其中可以组成单词的牌放在左边，把不能组成单词的牌放右边。」
 *
 * **点选的顺序就是你要拼的词**：点 C→A→T 是 CAT，点 A→C→T 是 ACT。
 * 白搭没有字母，选中时必须声明它代表哪个（RULES.md §10.2）。
 *
 * 系统**只回答对错，绝不列出「这几张还能拼成什么」**——那等于替玩家做完了思考。
 * 白搭尤其严重：随手点个 ★+C+D，系统白送 CAD/COD/CUD/DOC 四个词，
 * 学生根本不知道自己拼了什么。列词是提示功能的事，且要在正题集里留痕。
 */

import { useEffect, useRef, useState } from "react";
import type { Validation, Word } from "../api";
import { Tile, isWild, wildCandidates } from "./Tile";
import { WordTiles } from "./WordTiles";

interface Props {
  loose: string[];
  groups: Word[];
  /** 这一回合新进手的牌（摸的 / 亮词补摸的）——要醒目标出，否则一眼找不到新牌 */
  drawn?: string[];
  /** 吃牌 / 胡牌时，要一起参与拼词的那张牌（上家打出的、或刚摸到的） */
  extraTile?: string;
  onGroup: (tiles: string, word: string, expansion?: string) => void;
  onUngroup: (tiles: string) => void;
  onDiscard?: (tile: string) => void;
  onReveal?: (tiles: string, word: string, viaHint?: boolean, expansion?: string) => void;
  onChi?: (tiles: string, word: string, viaHint?: boolean, expansion?: string) => void;
  /** 胡牌：必须自己拼出最后那个词 */
  onWin?: (word: string, expansion?: string) => void;
  validate: (tiles: string, word: string, withTile?: string) => Promise<Validation>;
  canDiscard: boolean;
  canReveal: boolean;
  canWin: boolean;
  busy: boolean;
}

export function Hand({
  loose,
  groups,
  drawn,
  extraTile,
  onGroup,
  onUngroup,
  onDiscard,
  onReveal,
  onChi,
  onWin,
  validate,
  canDiscard,
  canReveal,
  canWin,
  busy,
}: Props) {
  /** 点选的散牌下标，**按点击先后排列** —— 这个顺序就是玩家要拼的词 */
  const [picked, setPicked] = useState<number[]>([]);
  /** 白搭声明代表的字母：散牌下标 → 字母 */
  const [wilds, setWilds] = useState<Record<number, string>>({});
  /** 胡牌/吃牌时，那张外来的牌排在词的第几位（0 = 最前） */
  const [extraPos, setExtraPos] = useState(0);
  const [check, setCheck] = useState<Validation | null>(null);
  /** 缩写的全称（RULES.md §8.3：拼对才算） */
  const [expansion, setExpansion] = useState("");

  /**
   * 进入胡牌状态时散牌有几张。用它来区分「刚进来」和「玩家重整了手牌」——
   * 不能用「这个 effect 跑过没有」之类的标志位：StrictMode 下 effect 会跑两遍，
   * 标志位第二遍就自己把自己坑了（实测：进来时一张牌都没选中）。
   */
  const winEnteredWith = useRef<number | null>(null);

  /**
   * 刚进入胡牌状态：自动全选散牌（胡牌要用光它们，玩家只需排顺序）。
   *
   * 但玩家**在决策期间重整手牌**（拆词/组词）之后就不能再全选了——他拆词正是
   * 为了重新分配，若又把全部散牌选上，他每点一张都变成「取消选中」，得先一张张
   * 取消才能开始挑。所以重整之后清空选择，让他自由挑；想全选按「重选」即可。
   */
  useEffect(() => {
    if (!canWin) {
      winEnteredWith.current = null;
      return;
    }
    setWilds({});
    setExtraPos(0);

    if (winEnteredWith.current === null) {
      winEnteredWith.current = loose.length;   // 刚进来
      setPicked(loose.map((_, i) => i));
    } else if (winEnteredWith.current !== loose.length) {
      setPicked([]);                           // 手牌被重整过了 —— 让玩家重新挑
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWin, loose.length]);

  /**
   * 胡牌必须**用光全部散牌**，一张不剩（RULES.md §5.1「零剩余」）。
   *
   * 之前只看 `canWin`（服务端说「你可以胡了」），于是玩家取消选中一张牌、
   * 剩下的碰巧还是个词时，胡牌按钮居然还在——点下去服务端才拒绝。
   * 按钮的可见性必须和「真的能胡」严格一致。
   */
  const usesAllLoose = picked.length === loose.length;
  const winnable = canWin && usesAllLoose;

  /**
   * 争到的那张牌（吃/胡）什么时候参与拼词？
   *
   * 吃牌时：一直参与（那本来就是要吃的牌）。
   * **胡牌时：只有选满全部散牌才参与。** 少选了几张，说明玩家是在**重整手牌**
   *   （拆掉旧词、把散牌重新分组），这时候拼的是暗词，那张争到的牌不该硬塞进去。
   *   不这么分开，玩家在胡牌状态下就永远组不了暗词——只能被逼着拼一个十几字母的词。
   */
  const useExtra = extraTile !== undefined && (!canWin || usesAllLoose);

  /** 外来的牌插在词的第几位。picked 变短时下标要跟着收窄，否则那张牌会漂到错位上 */
  const pos = Math.min(extraPos, picked.length);

  const letters = picked.map((i) => (isWild(loose[i]) ? wilds[i] ?? "" : loose[i]));
  const word = useExtra
    ? [...letters.slice(0, pos), extraTile!, ...letters.slice(pos)].join("")
    : letters.join("");

  const selectedTiles = picked.map((i) => loose[i]).join("");
  const complete = picked.every((i) => !isWild(loose[i]) || wilds[i]);

  /**
   * 「刚摸到」要高亮哪几张散牌。
   *
   * `drawn` 是这一回合新进手的牌（摸的那张，或亮词后补摸的几张），是个**多重集合**：
   * 手里可能本来就有一张 B，补摸又来一张 B —— 只该标其中一张。所以按数量逐个认领，
   * 不能用 `includes` 之类的集合判断。
   */
  const drawnIdx = new Set<number>();
  const pool = new Map<string, number>();
  for (const t of drawn ?? []) pool.set(t, (pool.get(t) ?? 0) + 1);
  loose.forEach((t, i) => {
    const left = pool.get(t) ?? 0;
    if (left > 0) {
      pool.set(t, left - 1);
      drawnIdx.add(i);
    }
  });

  // 拼出的词一变，就问服务端「这是不是个词」——只问对错，不问「还能拼什么」
  useEffect(() => {
    if (!complete || word.length < 2) {
      setCheck(null);
      return;
    }
    let stale = false;
    validate(selectedTiles, word, useExtra ? extraTile : undefined).then((v) => {
      if (!stale) setCheck(v);
    });
    return () => {
      stale = true;
    };
  }, [word, selectedTiles, extraTile, useExtra, complete, validate]);

  const toggle = (i: number) => {
    setPicked((p) => {
      if (!p.includes(i)) return [...p, i];
      // 取消选中白搭，就要把它声明的字母一起抹掉——否则牌面上还留着那个字母，
      // 下次再选中它时，会带着上次的旧字母，玩家却以为是新的
      if (isWild(loose[i])) {
        setWilds((w) => {
          const next = { ...w };
          delete next[i];
          return next;
        });
      }
      return p.filter((x) => x !== i);
    });
    setExpansion("");
  };

  /**
   * 全部清空。胡牌时清空没意义（必须用光散牌），所以改成「重选」：重新全选。
   *
   * **这里绝不能手动 setCheck(null)。** 校验结果只由上面那个 effect 负责，
   * 而 effect 的依赖是拼出来的词——重选之后若选择和原来完全一样（散牌只剩一张 H、
   * 自摸 A、词还是 AH），词没变，effect 就不会重跑，被清掉的校验结果再也没人补，
   * 界面会一直卡在「不是单词」，再点也没反应。校验结果必须只有一个来源。
   */
  const clear = () => {
    setWilds({});
    setExpansion("");
    setExtraPos(0);
    setPicked(canWin ? loose.map((_, i) => i) : []);
  };

  const needsExpansion = check?.isAbbr ?? false;
  const blocked = busy || (needsExpansion && !expansion.trim());
  const exp = () => expansion.trim() || undefined;

  /**
   * 白搭是全场最灵活的牌，打掉它是纯粹的浪费——不许打。
   * 但散牌区**只剩白搭**时必须放行：打牌是强制的，不放行就直接死局。
   */
  const discardable =
    picked.length === 1 &&
    (!isWild(loose[picked[0]]) || loose.every((t) => isWild(t)));

  /** 亮词 / 吃牌：牌 + 玩家拼的那个词 + （缩写的）全称 */
  const submitMeld = (
    fn?: (tiles: string, word: string, viaHint?: boolean, e?: string) => void,
  ) => {
    if (!check?.valid || !fn) return;
    fn(selectedTiles + (useExtra ? extraTile : ""), check.word!, false, exp());
    clear();
  };

  const submitGroup = () => {
    if (!check?.valid) return;
    onGroup(selectedTiles, check.word!, exp());
    clear();
  };

  /**
   * 一个词最多用一张白搭（RULES.md §1）。
   *
   * 服务端本来就拦得住（words_for 见到两张白搭直接返回「拼不成词」），但那个说法
   * 是误导的——明明是个词，只是白搭超额了。更糟的是玩家得先把两张白搭的字母都
   * 一一填完，才被告知不行。所以在这里当场拦下并说清楚。
   */
  const tooManyWilds = picked.filter((i) => isWild(loose[i])).length > 1;

  /** 还没声明字母的白搭 —— 逐个弹字母选择器（超额时不必再问了） */
  const pendingWild = tooManyWilds
    ? undefined
    : picked.find((i) => isWild(loose[i]) && !wilds[i]);

  return (
    <div className="hand">
      {/* ---- 已组好的暗词 ---- */}
      <div className="hand-zone">
        <div className="hand-zone-label">
          我组好的暗词
          <span className="hint-text">（点一下可拆开）</span>
        </div>
        <div className="hand-words">
          {groups.length === 0 && <div className="empty">还没组词</div>}
          {groups.map((g) => (
            <WordTiles
              key={g.tiles + g.word}
              tiles={g.tiles}
              word={g.word}
              onClick={busy ? undefined : () => onUngroup(g.tiles)}
              label="点击拆开"
            />
          ))}
        </div>
      </div>

      {/* ---- 散牌 ---- */}
      <div className="hand-zone">
        <div className="hand-zone-label">
          散牌 <span className="count">{loose.length}</span>
          <span className="hint-text">（按顺序点选字母，拼成单词）</span>
        </div>

        {/* 把牌全组进暗词、散牌区却空了，是个很容易掉进去的坑：打牌是强制的，
            而已组进单词的牌不能打。必须把这话讲明白，否则新手会卡在这里。 */}
        {canDiscard && loose.length === 0 ? (
          <div className="stuck">
            散牌区空了，但你必须打一张牌 —— 点上面任意一个暗词把它拆开
          </div>
        ) : (
          <div className="hand-tiles">
            {loose.map((t, i) => {
              const pos = picked.indexOf(i);
              return (
                <span key={i} className={drawnIdx.has(i) ? "drawn-slot" : undefined}>
                  {drawnIdx.has(i) && <span className="drawn-tag">刚摸到</span>}
                  <Tile
                    tile={t}
                    asLetter={wilds[i]}
                    selected={pos >= 0}
                    order={pos >= 0 ? pos + 1 : undefined}
                    onClick={busy ? undefined : () => toggle(i)}
                  />
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- 白搭：必须声明代表哪个字母 ---- */}
      {pendingWild !== undefined && (
        <div className="wild-picker">
          <span>
            这张<b>{isWild(loose[pendingWild]) && loose[pendingWild] === "1" ? "元音" : "辅音"}白搭</b>
            代表哪个字母？
          </span>
          <div className="wild-letters">
            {wildCandidates(loose[pendingWild]).map((c) => (
              <button
                key={c}
                type="button"
                className="wild-letter"
                onClick={() => setWilds((w) => ({ ...w, [pendingWild]: c }))}
              >
                {c.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- 白搭超额：当场说清楚，别让玩家填完字母才发现 ---- */}
      {tooManyWilds && (
        <div className="checker checker-bad">
          <span className="bad-mark">✗ 一个词最多只能用一张白搭</span>
          <div className="checker-actions">
            <button className="btn btn-ghost" onClick={clear}>
              {canWin ? "重选" : "取消"}
            </button>
          </div>
        </div>
      )}

      {/* ---- 校验条 ---- */}
      {picked.length > 0 && pendingWild === undefined && !tooManyWilds && (
        <div className={`checker ${check?.valid ? "checker-ok" : "checker-bad"}`}>
          {/* 外来的牌（吃/胡）要插进词里，玩家自己决定插在第几位。
              下拉的值用 pos（已按 picked 收窄），不是 extraPos——玩家取消选中
              若干张后，那张牌不能还「记着」原来那个越界的位置 */}
          {useExtra && (
            <div className="extra-slot">
              <span className="extra-label">这张排第</span>
              <select
                value={pos}
                onChange={(e) => setExtraPos(+e.target.value)}
                className="extra-select"
              >
                {Array.from({ length: picked.length + 1 }).map((_, i) => (
                  <option key={i} value={i}>
                    {i + 1}
                  </option>
                ))}
              </select>
              <Tile tile={extraTile!} small />
            </div>
          )}

          <div className="checker-word">
            {word.toUpperCase() || "…"}
            {check?.valid ? (
              <span className="ok-mark">✓</span>
            ) : (
              word.length >= 2 && <span className="bad-mark">✗ 不是单词</span>
            )}
          </div>

          {/* 胡牌得用光全部散牌。少选了几张，说明玩家是在**重整手牌**——
              这是允许的（拆词、重组暗词），只是这一步拼的是暗词，不是胡牌。
              必须讲清楚，否则玩家只会看到胡牌按钮莫名消失。 */}
          {canWin && !usesAllLoose && (
            <span className="checker-meta warn">
              这是在组暗词（选了 {picked.length}/{loose.length} 张）——
              要胡牌得选满全部散牌，和摸到的那张凑成一个词
            </span>
          )}

          {check?.valid && (
            <span className="checker-meta">
              {check.score} 分
              {check.inTier && " · 词库内 +10"}
              {check.drawCount! > 0 && ` · 亮出可补摸 ${check.drawCount} 张`}
            </span>
          )}

          {/* 缩写必须当场拼全称，拼错不算拼成（RULES.md §8.3） */}
          {needsExpansion && (
            <div className="expansion">
              <span>「{check!.word!.toUpperCase()}」是缩写，请拼出全称：</span>
              <input
                className="expansion-input"
                value={expansion}
                onChange={(e) => setExpansion(e.target.value)}
                placeholder="如 television"
                spellCheck={false}
                autoFocus
              />
            </div>
          )}

          <div className="checker-actions">
            {/* 胡牌：必须自己拼出最后那个词，且**用光全部散牌** */}
            {winnable && check?.valid && onWin && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  onWin(check.word!, exp());
                  clear();
                }}
                disabled={blocked}
              >
                🏆 胡牌
              </button>
            )}

            {/* 吃牌 */}
            {!canWin && useExtra && check?.valid && check.canReveal && onChi && (
              <button className="btn btn-primary" onClick={() => submitMeld(onChi)} disabled={blocked}>
                吃并亮出
              </button>
            )}

            {/* 组暗词。
                **胡牌时也必须能组** —— 玩家常常需要在「要不要胡」这一刻重整手牌：
                拆掉旧词、把散牌重新分组，好让最后剩下的那几张 + 争到的牌恰好成一个词。
                以前这里被 `!canWin` 关掉了，于是玩家一旦拆了词就再也组不回去，
                被逼着去拼一个十几字母的单词——死路一条。 */}
            {!useExtra && check?.valid && (
              <button className="btn btn-primary" onClick={submitGroup} disabled={blocked}>
                组成暗词
              </button>
            )}

            {/* 亮词 */}
            {!canWin && !useExtra && check?.valid && check.canReveal && canReveal && onReveal && (
              <button className="btn" onClick={() => submitMeld(onReveal)} disabled={blocked}>
                亮出（补摸 {check.drawCount} 张）
              </button>
            )}

            {/* 打牌——只能打散牌区的牌 */}
            {!canWin && !useExtra && picked.length === 1 && canDiscard && onDiscard && (
              discardable ? (
                <button
                  className="btn btn-warn"
                  onClick={() => {
                    onDiscard(loose[picked[0]]);
                    clear();
                  }}
                  disabled={busy}
                >
                  打出这张
                </button>
              ) : (
                <span className="checker-meta warn">白搭不能打出</span>
              )
            )}

            {/* 胡牌时也要能重来——白搭的字母选错了，总得有路可退。
                胡牌必须用光散牌，所以这里不是清空，而是重新全选 */}
            <button className="btn btn-ghost" onClick={clear}>
              {canWin ? "重选" : "取消"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
