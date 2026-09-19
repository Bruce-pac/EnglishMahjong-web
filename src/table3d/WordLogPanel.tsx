/**
 * P18：右上角「📜 N」，点开是本局词条的下拉面板。交互照 ⚙：再点、点画面别处、Esc 收起，
 * 悬停 ⓘ 也收起；和 ⚙ 互斥（由 Table3D 管开关状态）。
 *
 * 不常驻：四个角都是亮词区，右侧中部压下家手牌和角色，找不到空地（用户定）。
 * 只列词本身——前端没有词典，不显示释义。
 */

import { useEffect, useRef } from "react";
import { AI_NAMES } from "./names";
import type { WordEntry } from "./word-log";

/** 最后几条算「新的」，更早的降低不透明度 */
const FRESH = 2;

export function WordLogPanel({
  open,
  log,
  mySeat,
  onToggleOpen,
}: {
  open: boolean;
  log: readonly WordEntry[];
  mySeat: number;
  onToggleOpen: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // 打开时、有新词进来时滚到底（最新的在最下面）
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, log.length]);

  return (
    <div className="table3d-wordlog">
      <button
        className="table3d-prefs-btn"
        aria-expanded={open}
        aria-label="本局词条"
        title="本局词条"
        onClick={onToggleOpen}
      >
        📜 {log.length}
      </button>
      {open && (
        <div className="table3d-wordlog-panel" role="group" aria-label="本局词条">
          <h4>本局词条</h4>
          <div className="table3d-wordlog-list" ref={listRef}>
            {log.length === 0 && <div className="table3d-wordlog-empty">还没有人亮词</div>}
            {log.map((e, i) => (
              <div key={i} className={`table3d-wordlog-row${i < log.length - FRESH ? " old" : ""}`}>
                <span className="who">{e.seat === mySeat ? "你" : (AI_NAMES[e.seat] ?? `${e.seat} 号`)}</span>
                {e.act && <span className={`act ${e.act}`}>{e.act === "chi" ? "吃" : "亮"}</span>}
                <span className="w">{e.word.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
