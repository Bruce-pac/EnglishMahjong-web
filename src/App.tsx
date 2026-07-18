import { useEffect, useState } from "react";
import type { MatchConfig } from "./api";
import { Hand } from "./components/Hand";
import { Profile } from "./components/Profile";
import { Scoreboard } from "./components/Scoreboard";
import { Spectating } from "./components/Spectating";
import { Table } from "./components/Table";
import { Tile } from "./components/Tile";
import { WordTiles } from "./components/WordTiles";
import { useGame } from "./hooks/useGame";

const TIERS = [
  ["junior", "初中"],
  ["senior", "高中"],
  ["cet4", "四级"],
  ["cet6", "六级"],
  ["kaoyan", "考研"],
  ["toefl", "托福"],
  ["gre", "GRE"],
];

const DEFAULTS: MatchConfig = {
  tier: "junior",
  minWordLen: 2,
  minWinWordLen: 0,
  hints: false,
  bloody: true,
  difficulty: "normal",
  maxGames: 4,
};

/** 开局设置。默认值＝发明者的原规则，一个字没改。 */
function Setup({ onStart }: { onStart: (c: MatchConfig) => void }) {
  const [c, setC] = useState<MatchConfig>(DEFAULTS);
  const [showProfile, setShowProfile] = useState(false);
  const set = (k: keyof MatchConfig, v: unknown) => setC({ ...c, [k]: v });

  return (
    <div className="setup">
      <h1>英语麻将</h1>
      <p className="tagline">三缺一，就差一个背单词的你</p>

      <div className="setup-grid">
        <label>
          词库
          <select value={c.tier} onChange={(e) => set("tier", e.target.value)}>
            {TIERS.map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label>
          AI 难度
          <select value={c.difficulty} onChange={(e) => set("difficulty", e.target.value)}>
            <option value="easy">简单（词汇量低一档）</option>
            <option value="normal">普通（和你同档）</option>
            <option value="hard">困难（词汇量高一档）</option>
          </select>
        </label>

        <label>
          局数
          <select value={c.maxGames} onChange={(e) => set("maxGames", +e.target.value)}>
            {[1, 2, 4, 8].map((n) => (
              <option key={n} value={n}>
                {n} 局{n === 4 && "（每人坐一次庄）"}
              </option>
            ))}
          </select>
        </label>

        <label>
          最短词长
          <select value={c.minWordLen} onChange={(e) => set("minWordLen", +e.target.value)}>
            <option value={2}>2（默认）</option>
            <option value={3}>3（禁掉 at 等双字母词）</option>
            <option value={4}>4</option>
          </select>
        </label>

        <label>
          起胡门槛
          <select value={c.minWinWordLen} onChange={(e) => set("minWinWordLen", +e.target.value)}>
            <option value={0}>关（默认）</option>
            <option value={5}>至少一个 5 字母词</option>
            <option value={6}>至少一个 6 字母词</option>
            <option value={7}>至少一个 7 字母词</option>
          </select>
        </label>

        <label>
          血战到底
          <select value={c.bloody ? "on" : "off"} onChange={(e) => set("bloody", e.target.value === "on")}>
            <option value="on">开（默认，先胡的退出，其余人继续）</option>
            <option value="off">关（第一人胡牌，本局立即结束）</option>
          </select>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={c.hints}
            onChange={(e) => set("hints", e.target.checked)}
          />
          开启提示
        </label>
      </div>

      <p className="note">
        第一次玩？直接点开始就好。玩熟了觉得不过瘾，
        把<b>起胡门槛</b>调高 —— 牌局更长、更烧脑。
      </p>

      <button className="btn btn-primary btn-big" onClick={() => onStart(c)}>
        开始
      </button>

      <button className="btn btn-ghost" onClick={() => setShowProfile(true)}>
        📖 单词本
      </button>

      {showProfile && <Profile onClose={() => setShowProfile(false)} />}
    </div>
  );
}

export default function App() {
  const g = useGame();
  const [config, setConfig] = useState<MatchConfig | null>(null);

  // 刷新页面不该丢掉整局牌。URL 上带 ?match=<id> 就把它捞回来。
  // （测试脚本也靠它接管一局用 /api/dev/setup 摆好的牌。）
  const resume = g.resume;
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("match");
    if (id) {
      setConfig(DEFAULTS);
      resume(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!config || !g.env) {
    return (
      <Setup
        onStart={(c) => {
          setConfig(c);
          g.newMatch(c);
        }}
      />
    );
  }

  const { state, pending, result, matchFinished } = g.env;
  const { me } = state;

  const live = pending?.kind === "chi" ? pending.tile : null;
  const myTurn = pending !== null;

  return (
    <div className="app">
      <header>
        <span className="brand">英语麻将</span>
        {/* 玩法开关常亮在顶栏——起胡门槛记不住的话，玩家会拿着不够门槛的牌
            白高兴。读服务端下发的 state.config：本地 config 在刷新恢复时是默认值 */}
        <span>
          词库 <b>{TIERS.find((t) => t[0] === state.config.tier)?.[1]}</b>
        </span>
        <span>
          难度 <b>{{ easy: "简单", normal: "普通", hard: "困难" }[state.config.difficulty]}</b>
        </span>
        <span title="拼出的词至少要几个字母">
          词长 <b>≥{state.config.minWordLen}</b>
        </span>
        <span title="胡牌时手上至少要有一个这么长的词">
          起胡 <b>{state.config.minWinWordLen ? `≥${state.config.minWinWordLen}` : "关"}</b>
        </span>
        <span title="开：先胡的退出，其余人继续；关：第一人胡牌本局即结束">
          血战 <b>{state.config.bloody ? "开" : "关"}</b>
        </span>
        <span>
          牌墙 <b>{state.wallLeft}</b>
        </span>
        <span>
          第 <b>{state.gamesPlayed + 1}</b>/{state.maxGames} 局
        </span>
        <span className="budget" title="14 张预算：每亮出一个词占 3 格，无论词多长">
          预算 <b>{me.budgetLeft}</b>/14
        </span>
        {state.config.hints && <span className="tag-hint">提示已开</span>}
      </header>

      {/* 操作记录：滚动日志，最近几条一直可见——横幅一闪就没了，一不注意就不知道
          刚才发生了什么。最新的一条高亮。 */}
      {g.log.length > 0 && (
        <div className="log-panel">
          {g.log.slice(-5).map((entry, i, arr) => (
            <div key={entry.id} className={i === arr.length - 1 ? "log-line log-latest" : "log-line"}>
              {entry.text}
            </div>
          ))}
        </div>
      )}

      <Table others={state.others} discards={state.discards} turn={state.turn} live={live} />

      {/* 我亮出的明词 */}
      {me.melds.length > 0 && (
        <div className="my-melds">
          <span className="hand-zone-label">我亮出的词</span>
          {me.melds.map((m) => (
            <WordTiles key={m.tiles} tiles={m.tiles} word={m.word} />
          ))}
        </div>
      )}

      {/* 决策条 */}
      {pending && (
        <div className="prompt">
          {pending.kind === "discard" && <b>轮到你出牌 —— 从散牌里点一张打出</b>}
          {/* 亮词不用先「过」：直接打一张牌就等于放弃亮词（测试bug.md） */}
          {pending.kind === "reveal" && <b>可以亮词（补摸 词长 − 3 张），或直接打一张牌</b>}
          {pending.kind === "chi" && (
            <b>
              上家打出 <Tile tile={pending.tile!} small /> —— 要吃吗？（拼成 ≥3 字母的词）
            </b>
          )}
          {/* 只说「你可以胡了」，**绝不说拼成了什么词**——那个词必须由玩家自己
              从散牌里拼出来。服务器把答案说出来，就等于替他赢了。 */}
          {pending.kind === "win" && (
            <b className="win-call">
              {pending.selfDrawn ? "你摸到" : "对手打出"} <Tile tile={pending.tile!} small />
              {" "}—— 你可以胡了！<span className="win-hint">用它和全部散牌，拼出最后一个单词 ↓</span>
            </b>
          )}

          {/* 「过」只在拒绝别人的牌时有意义（吃/胡）。亮词阶段直接打牌即是过，
              按钮反而逼人多点一下 */}
          {pending.canPass && pending.kind !== "reveal" && (
            <button className="btn btn-ghost" onClick={g.pass} disabled={g.busy}>
              过
            </button>
          )}
        </div>
      )}

      {/* 提示面板 —— 用了提示会在正题集里留下印记，不扣分、不影响胜负。
          白搭词也给，但必须标明白搭代什么字母，不然提示了也用不上。 */}
      {pending && pending.hints.length > 0 && (
        <div className="hints">
          <span className="hints-label">💡 提示</span>
          {pending.hints.slice(0, 5).map((h) => (
            <button
              key={h.tiles + h.word}
              className="btn btn-hint"
              disabled={g.busy}
              onClick={() =>
                pending.kind === "chi"
                  ? g.chi(h.tiles, h.word, true)
                  : g.reveal(h.tiles, h.word, true)
              }
            >
              {h.word.toUpperCase()}
              {h.wild && <span className="wild-note">★={h.wild.toUpperCase()}</span>}
            </button>
          ))}
          <span className="hints-note">用提示不扣分，但这个词会被标记「被提示」</span>
        </div>
      )}

      {/* 胡牌退出后，手牌区换成观战条——否则界面一片死寂，
          你连自己在等什么都不知道，还以为卡死了 */}
      {me.won ? (
        <Spectating me={me} others={state.others} />
      ) : (
      <Hand
        loose={me.loose}
        groups={me.groups}
        drawn={me.drawn}
        extraTile={(pending?.kind === "chi" || pending?.kind === "win") ? pending.tile! : undefined}
        onGroup={g.group}
        onUngroup={g.ungroup}
        onDiscard={g.discard}
        onReveal={g.reveal}
        onChi={g.chi}
        onWin={g.win}
        validate={g.validate}
        canDiscard={pending?.kind === "discard" || pending?.kind === "reveal"}
        canReveal={pending?.kind === "reveal"}
        canWin={pending?.kind === "win"}
        busy={g.busy || !myTurn}
      />
      )}

      {/* 胡牌特效——没有它，点完「胡牌」画面只有左上角日志在滚，像卡死了 */}
      {g.celebrate && (
        <div className="celebrate">
          <div className="celebrate-card">
            <div className="celebrate-icon">🏆</div>
            <div className="celebrate-who">
              {g.celebrate.seat === 0 ? "你" : `AI-${g.celebrate.seat}`}
              {g.celebrate.selfDrawn ? " 自摸！" : " 胡牌！"}
            </div>
            <div className="celebrate-order">第 {(g.celebrate.order ?? 0) + 1} 个胡</div>
          </div>
        </div>
      )}

      {g.error && (
        <div className="error" onClick={g.clearError}>
          {g.error}
        </div>
      )}

      {result && (
        <Scoreboard
          result={result}
          state={state}
          matchFinished={matchFinished}
          onNext={g.nextGame}
          onRestart={() => {
            setConfig(null);
          }}
        />
      )}
    </div>
  );
}
