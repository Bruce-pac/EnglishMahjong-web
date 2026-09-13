/**
 * T6.2：提示列表（DOM）。
 *
 * **前端不算任何候选词**：只展示服务端给的 `pending.hints`。显示顺序按「现在能不能直接用」分三组
 * 再取前 5 项（`orderHints`），每组内部保持服务端的顺序——只是重排显示，不增不减候选。
 * 提示关闭时服务端根本不算、`hints` 恒为空——这里再加一道：`enabled` 为假就整个不渲染，
 * 页面上不出现任何提示入口（CLAUDE.md「教学产品的设计红线」）。
 *
 * 点某一项只是告诉调用方「玩家点了它」：调用方去高亮对应的散牌、记下点过的词（viaHint）。
 * **不替玩家排牌、不自动选中**——排列即单词，还得玩家自己排、自己框
 */

import type { Pending } from "../api";

export type Hint = Pending["hints"][number];

/**
 * 一条提示后面的注明。`info` 是中性的告知（「已组成暗词」，灰绿色），
 * `warn` 是需要玩家先做点什么（「要先拆开暗词」，偏红）
 */
export interface HintNote {
  text: string;
  tone: "info" | "warn";
}

/** 最多展示几项 */
export const MAX_HINTS = 5;

/**
 * 提示的显示顺序（用户定）：只用散牌就能拼的 → 要先拆开暗词的 → 已组成暗词的，每组内部保持服务端的顺序。
 *
 * 服务端用**整手牌**算提示、按词长和分数排，手里一有暗词，排在最前面的长词几乎都要借暗词里的牌——
 * 实测暗词 CAT + 10 张散牌时，190 多条提示的前 5 条全是「要先拆开暗词」，能直接用的短词一条都露不出来。
 * 已组成的暗词是中性告知，不占前面的名额：前两组凑不满 5 项时才露出来
 */
export function orderHints(hints: readonly Hint[], note: (hint: Hint) => HintNote | null): Hint[] {
  const rank = (h: Hint) => {
    const n = note(h);
    return n === null ? 0 : n.tone === "warn" ? 1 : 2;
  };
  // Array.prototype.sort 是稳定的：同组内保持服务端顺序
  return [...hints].sort((a, b) => rank(a) - rank(b));
}

interface ListProps {
  hints: readonly Hint[];
  /** 点过的那个词（高亮这一项） */
  picked: string | null;
  /**
   * 这一项后面的注明：已经是玩家自己的暗词 →「已组成暗词」；要借用暗词里的牌 →「要先拆开暗词」；
   * 只用散牌就对应得上 → null。服务端用整手牌算提示，暗词里的牌也算进去，所以两种情况都会出现
   */
  note: (hint: Hint) => HintNote | null;
  onPick: (hint: Hint) => void;
}

/** 提示词列表本体。自己回合的 [提示] 面板和提示模式的吃牌候选共用 */
export function HintList({ hints, picked, note, onPick }: ListProps) {
  return (
    <ul className="table3d-hints">
      {orderHints(hints, note).slice(0, MAX_HINTS).map((h, i) => (
        <li key={`${h.word}-${i}`}>
          <button
            className={`table3d-hint-item${picked === h.word.toLowerCase() ? " picked" : ""}`}
            onClick={() => onPick(h)}
          >
            <span className="word">{h.word.toUpperCase()}</span>
            {h.wild && <span className="tag">★={h.wild.toUpperCase()}</span>}
            {h.isAbbr && <span className="tag">缩写</span>}
            {(() => {
              const n = note(h);
              return n && <span className={`tag ${n.tone}`}>{n.text}</span>;
            })()}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface PanelProps extends ListProps {
  /** `state.config.hints`：本场开没开提示 */
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}

/** 自己回合（要不要亮词的决策）的 [提示] 面板：一个开关按钮 + 展开的列表 */
export function HintPanel({ enabled, open, onToggle, ...list }: PanelProps) {
  if (!enabled || list.hints.length === 0) return null;
  return (
    <div className="table3d-hint-panel">
      <button className="table3d-act-btn" onClick={onToggle}>
        {open ? "收起提示" : "提示"}
      </button>
      {open && <HintList {...list} />}
    </div>
  );
}
