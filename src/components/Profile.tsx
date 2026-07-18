/**
 * 单词本 —— 跨场累积的正题集 / 错题集（RULES.md §9），带释义和朗读。
 *
 * 结算页只看得到「这一局」的收获；这里是长期账本，也是复习的入口：
 * 一行一词（小写更接近阅读时的样子），点「释义」行内展开中文意思（本地词表，
 * 零外部依赖），点 🔊 用浏览器自带的语音合成朗读——都不需要联网查询。
 *
 * 数据挂在匿名 playerId 名下、存在服务端——换设备/清 localStorage 会丢，
 * 将来的「绑定账号」就是为此准备的后路。
 */

import { useEffect, useState } from "react";
import { api, type ProfileData } from "../api";

/** 浏览器自带的语音合成。美音优先；没有语音包就静默失败，不弹错 */
function speak(word: string) {
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US";
  u.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/** 释义缓存：一个词一场里只查一次 */
const defCache = new Map<string, { found: boolean; phonetic?: string; definition?: string }>();

function WordRow({
  word,
  badges,
  bad,
}: {
  word: string;
  badges?: string;
  bad?: boolean;
}) {
  const [def, setDef] = useState(defCache.get(word) ?? null);
  const [open, setOpen] = useState(false);

  const toggleDef = async () => {
    if (!open && !def) {
      const d = await api.define(word).catch(() => ({ found: false }));
      defCache.set(word, d);
      setDef(d);
    }
    setOpen(!open);
  };

  return (
    <div className={bad ? "word-row word-row-bad" : "word-row"}>
      <div className="word-row-main">
        <span className="word-row-word">{word}</span>
        {def?.found && def.phonetic && open && (
          <span className="word-row-phonetic">/{def.phonetic}/</span>
        )}
        {badges && <span className="word-row-badges">{badges}</span>}
        <span className="word-row-actions">
          <button className="btn btn-mini" onClick={() => speak(word)} title="朗读">
            🔊
          </button>
          <button className="btn btn-mini" onClick={toggleDef}>
            释义
          </button>
        </span>
      </div>
      {open && (
        <div className="word-row-def">
          {def?.found ? def.definition : "暂无释义 —— 这个词不在内置词表里"}
        </div>
      )}
    </div>
  );
}

export function Profile({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.profile().then(setData).catch((e) => setError(String(e.message ?? e)));
  }, []);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet sheet-wordbook" onClick={(e) => e.stopPropagation()}>
        <h2>单词本</h2>

        {error && <p className="empty">{error}</p>}
        {!data && !error && <p className="empty">加载中…</p>}

        {data && (
          <>
            <p className="profile-stats">
              共打了 <b>{data.games.played}</b> 局，胡了 <b>{data.games.won}</b> 局
            </p>

            <div className="profile">
              <div className="profile-box profile-ok">
                <div className="profile-title">✅ 拼出过的词（{data.correct.length}）</div>
                <div className="word-list">
                  {data.correct.length ? (
                    data.correct.map((r) => (
                      <WordRow
                        key={r.word}
                        word={r.word}
                        badges={[
                          r.count > 1 ? `×${r.count}` : "",
                          r.hinted ? "💡" : "",
                          r.wasWrong ? "🔁" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      />
                    ))
                  ) : (
                    <span className="empty">还没拼出过词——开一局试试</span>
                  )}
                </div>
                {data.correct.some((r) => r.hinted || r.wasWrong) && (
                  <p className="profile-legend">💡 = 用提示拼出　🔁 = 曾漏过（后来攻克了）</p>
                )}
              </div>

              <div className="profile-box profile-bad">
                <div className="profile-title">❌ 漏掉的词（{data.wrong.length}）</div>
                <div className="missed-lead">这些词你本来能拼出来，但没看出来：</div>
                <div className="word-list">
                  {data.wrong.length ? (
                    data.wrong.map((r) => (
                      <WordRow
                        key={r.word}
                        word={r.word}
                        bad
                        badges={r.missedCount > 1 ? `漏过 ${r.missedCount} 次` : ""}
                      />
                    ))
                  ) : (
                    <span className="empty">干干净净——没有待攻克的词</span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="sheet-actions">
          <button className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
