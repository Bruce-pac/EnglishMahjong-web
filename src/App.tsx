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

/** 首页只做门面：是什么、为什么好玩、一个大大的「开始游戏」。配置全部收进设置页。 */
function Landing({ onStart }: { onStart: () => void }) {
  const [showProfile, setShowProfile] = useState(false);

  return (
    <div className="landing">
      <div className="hero">
        {/* 用游戏里真实的牌当 logo——元音红、辅音黑，一眼看出这是字母麻将 */}
        <div className="hero-tiles">
          <Tile tile="a" />
          <Tile tile="b" />
          <Tile tile="c" />
        </div>
        <h1>英语麻将</h1>
        <p className="tagline">三缺一，就差一个背单词的你</p>
      </div>

      <div className="feature-cards">
        <div className="feature-card">
          <div className="feature-icon feature-icon-green">🀄</div>
          <h3>拼词竞技</h3>
          <p>13 张字母牌起手，摸牌打牌，把手牌拼成英语单词——多组词、组长词才能赢。</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon feature-icon-blue">🤖</div>
          <h3>AI 对战</h3>
          <p>三名 AI 牌友随开随打。词汇量按档位分级——从初中到 GRE，难度你说了算。</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon feature-icon-gold">📖</div>
          <h3>单词本</h3>
          <p>拼过的词、漏掉的词自动记下来，带音标、释义和朗读，打完就能复习。</p>
        </div>
      </div>

      <button className="btn btn-primary btn-cta" onClick={onStart}>
        ▶ 开始游戏
      </button>

      <div className="landing-links">
        <button
          className="btn btn-ghost"
          onClick={() => document.getElementById("rules")?.scrollIntoView({ behavior: "smooth" })}
        >
          ❓ 游戏规则
        </button>
        <button className="btn btn-ghost" onClick={() => setShowProfile(true)}>
          📖 单词本
        </button>
      </div>

      <div className="rules-card" id="rules">
        <h2>游戏规则</h2>
        <ol className="rules-list">
          <li>
            <b>基本玩法</b>
            用 108 张字母牌代替麻将牌。每人 13 张起手，轮流摸牌、打牌，把手里的牌拼成英语单词。
          </li>
          <li>
            <b>亮词与暗词</b>
            拼成的词可以亮出来——亮词补摸「词长 − 3」张，推进快；也可以扣在手里当暗词，难度大，得分 ×2。
          </li>
          <li>
            <b>吃牌</b>
            上家打出的牌可以吃，但必须当场和手里的牌拼成 ≥3 字母的词亮出，不能白拿进手。
          </li>
          <li>
            <b>胡牌</b>
            14 张预算被单词填满、零剩余即胡——亮词无论多长只占 3 格，暗词按实际字母数占格。血战到底：先胡的退出，其余人继续。
          </li>
          <li>
            <b>计分</b>
            字母越稀有分越高，得分再乘词长——词越长涨得越狠；命中本局词库 +10，先胡有名次奖励。
          </li>
        </ol>
      </div>

      <footer className="landing-footer">
        <p>© 2026 英语麻将 · 词典和规则都在本地，游戏中不依赖外部服务</p>
      </footer>

      {showProfile && <Profile onClose={() => setShowProfile(false)} />}
    </div>
  );
}

/** 分段选择：一排大按钮，选中态高亮。移动端也点得准，不用下拉框。 */
function Seg({
  options,
  value,
  onChange,
}: {
  options: [string | number, string][];
  value: string | number;
  onChange: (v: string | number) => void;
}) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button
          key={v}
          className={v === value ? "seg-btn seg-on" : "seg-btn"}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** 开关行：标签 + 说明 + 滑动开关 */
function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="switch-row">
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        <span className="switch-hint">{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-knob" />
    </label>
  );
}

/** 游戏设置页。默认值＝发明者的原规则，一个字没改。 */
function Setup({ onStart, onBack }: { onStart: (c: MatchConfig) => void; onBack: () => void }) {
  const [c, setC] = useState<MatchConfig>(DEFAULTS);
  const set = (k: keyof MatchConfig, v: unknown) => setC({ ...c, [k]: v });

  return (
    <div className="setup-page">
      <div className="setup-top">
        <button className="btn btn-ghost" onClick={onBack}>
          ← 返回首页
        </button>
        <h1>游戏设置</h1>
      </div>

      <div className="setup-card">
        <div className="setup-group">
          <div className="setup-group-label">词库</div>
          <Seg options={TIERS as [string, string][]} value={c.tier} onChange={(v) => set("tier", v)} />
          <p className="setup-group-hint">加分和提示都围着这个词库转；AI 的词汇量也跟着它走。</p>
        </div>

        <div className="setup-group">
          <div className="setup-group-label">AI 难度</div>
          <Seg
            options={[
              ["easy", "简单"],
              ["normal", "普通"],
              ["hard", "困难"],
            ]}
            value={c.difficulty}
            onChange={(v) => set("difficulty", v)}
          />
          <p className="setup-group-hint">简单＝AI 词汇量低一档；困难＝高一档。</p>
        </div>

        <div className="setup-group">
          <div className="setup-group-label">局数</div>
          <Seg
            options={[
              [1, "1 局"],
              [2, "2 局"],
              [4, "4 局"],
              [8, "8 局"],
            ]}
            value={c.maxGames}
            onChange={(v) => set("maxGames", +v)}
          />
          <p className="setup-group-hint">4 局＝每人坐一次庄。</p>
        </div>

        <div className="setup-group">
          <div className="setup-group-label">最短词长</div>
          <Seg
            options={[
              [2, "2（默认）"],
              [3, "3"],
              [4, "4"],
            ]}
            value={c.minWordLen}
            onChange={(v) => set("minWordLen", +v)}
          />
          <p className="setup-group-hint">调到 3 会禁掉 at、is 这类双字母词。</p>
        </div>

        <div className="setup-group">
          <div className="setup-group-label">起胡门槛</div>
          <Seg
            options={[
              [0, "关（默认）"],
              [5, "≥5 字母"],
              [6, "≥6 字母"],
              [7, "≥7 字母"],
            ]}
            value={c.minWinWordLen}
            onChange={(v) => set("minWinWordLen", +v)}
          />
          <p className="setup-group-hint">胡牌时手上至少要有一个这么长的词。玩熟了往上调——牌局更长、更烧脑。</p>
        </div>

        <Switch
          label="血战到底"
          hint="开：先胡的退出，其余人继续；关：第一人胡牌本局即结束"
          checked={c.bloody}
          onChange={(v) => set("bloody", v)}
        />
        <Switch
          label="提示"
          hint="拿不准时给候选词。用了不扣分，但那个词会在单词本里标「被提示」"
          checked={c.hints}
          onChange={(v) => set("hints", v)}
        />

        <button className="btn btn-primary btn-cta" onClick={() => onStart(c)}>
          ▶ 开始游戏
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const g = useGame();
  const [config, setConfig] = useState<MatchConfig | null>(null);
  const [view, setView] = useState<"landing" | "setup">("landing");

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
    if (view === "landing") {
      return <Landing onStart={() => setView("setup")} />;
    }
    return (
      <Setup
        onBack={() => setView("landing")}
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
