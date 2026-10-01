import { lazy, Suspense, useEffect, useState } from "react";
import { AI_NAMES } from "./aiNames";
import { api, type AccountState, type MatchConfig, type MyStanding, type ProfileData } from "./api";
import { Account } from "./components/Account";
import { isMuted, setMuted } from "./sound";
import { defaultTableStyle, detectDevice, type TableStyle } from "./table-style";
import { Hand } from "./components/Hand";
import { Profile } from "./components/Profile";
import { RulesPage } from "./components/RulesPage";
import { Leaderboard } from "./components/Leaderboard";
import { Scoreboard } from "./components/Scoreboard";
import { Seg } from "./components/Seg";
import { Spectating } from "./components/Spectating";
import { TableScene } from "./scene/TableScene";
import { Tile } from "./components/Tile";
import { WordTiles } from "./components/WordTiles";
import { WordListSetting } from "./components/WordLists";
import { listProgress } from "./wordLists";
import { canSkipReplay } from "./spectate";
import { useGame } from "./hooks/useGame";

/**
 * 3D 牌桌按需加载：three.js 有 500KB 上下，而 2.5D 才是并存期的主路径，
 * 直接 import 会让每个进首页的人白下一份。
 */
const Table3D = lazy(() => import("./table3d/Table3D").then((m) => ({ default: m.Table3D })));

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

/** 首页复习卡上摆几张牌：最近拼出的词，总数封顶免得长词把一行撑爆。 */
/**
 * 复习卡上摆几个词。
 *
 * 容量按**大约两行**给，不是按一行——多数人的错题就只有一两三个（线上实测 14 个
 * 有错题的玩家里 11 个是 1~3 个），卡得太死就会出现「文案写 3 个、牌只摆 2 个、
 * 右边还空着」，粗看像是没渲染全（测试bug.md）。摆得下就全摆出来，
 * 摆不下才由调用方改口说「比如」。
 *
 * 库里最长的词 9 个字母（330px），卡片一行放得下 455px，所以单个词不会被折断。
 */
const MAX_SHOWCASE_WORDS = 4;
// 按像素收而不是按字母数：字母数一样、词数不同，实际宽度差着好几十像素（词间距 22px）。
// 收在**一行**以内——挂单一个词的第二行看着就是没排整齐。窄屏放不下自然会换行，
// 那是设备决定的，不是这里算错了。
const CARD_CONTENT_PX = 515; // 卡片封顶 560 − 左右内边距和左边那道金边
const TILE_PX = 34;
const TILE_GAP_PX = 3;
const WORD_GAP_PX = 22;

const wordPx = (word: string) => word.length * TILE_PX + (word.length - 1) * TILE_GAP_PX;

function showcaseWords(words: string[]): string[] {
  const picked: string[] = [];
  let used = 0;
  for (const word of words) {
    if (picked.length >= MAX_SHOWCASE_WORDS) break;
    const next = used + (picked.length ? WORD_GAP_PX : 0) + wordPx(word);
    if (next > CARD_CONTENT_PX) continue; // 这个摆不下，试下一个更短的
    picked.push(word);
    used = next;
  }
  return picked;
}

/** 首页只做门面：是什么、为什么好玩、一个大大的「开始游戏」。配置全部收进设置页。
 *
 * 页面上只有**一个**主动作。以前「游戏规则 / 单词本 / 登录注册」三个同款描边按钮
 * 并排贴在 CTA 底下，眼睛读成四个按钮，主次就没了；而这三件事根本不同类——
 * 一个是页面跳转、一个是个人数据、一个是全局账号状态。现在各归各位：
 * 账号去右上角常驻，规则降为 CTA 底下的文字链，单词本沉到下面变成一张
 * 有真实内容的卡片（且只在你真攒下东西时才出现）。
 */
function Landing({
  onStart,
  onRules,
  account,
  onAccount,
  identityRev,
}: {
  onStart: () => void;
  onRules: () => void;
  account: AccountState | null;
  onAccount: () => void;
  identityRev: number;
}) {
  const [showProfile, setShowProfile] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  // 复习卡的数据。拉失败就当没有——首页少一张卡而已，不值得打扰用户。
  //
  // 依赖 identityRev 而不是空数组：登录/注册/退出换掉的是本地 playerId，而档案是
  // 跟着 playerId 走的。只在挂载时拉一次的话，退出登录后卡片还挂着上一个人的词
  // （测试bug.md）。先清空再拉，也免得新身份的数据到位前那几百毫秒里露着旧的。
  const [profile, setProfile] = useState<ProfileData | null>(null);
  useEffect(() => {
    let alive = true;
    setProfile(null);
    api.profile().then(
      (p) => alive && setProfile(p),
      () => alive && setProfile(null),
    );
    // 连着切两次账号时，先发的请求可能后到——过期的响应直接丢掉
    return () => {
      alive = false;
    };
  }, [identityRev]);

  // 百分位也挂在复习卡上，所以和上面同一个依赖：换账号后一起刷新
  const [standing, setStanding] = useState<MyStanding | null>(null);
  useEffect(() => {
    let alive = true;
    setStanding(null);
    api.leaderboard().then(
      (d) => alive && setStanding(d.me),
      () => alive && setStanding(null),
    );
    return () => {
      alive = false;
    };
  }, [identityRev]);

  const learned = profile?.correct.length ?? 0;
  const toReview = profile?.wrong.length ?? 0;
  // 卡片摆的是**错题**：它叫复习卡，该摆没拿下的词，不是已经会了的。
  // 服务端的错题按「漏过次数」倒序发来（db.get_profile），排在前面的正是最该先看的。
  // 一个错题都没有的人另说——那时摆拼出过的词，是战果不是待办。
  const source =
    toReview > 0
      ? (profile?.wrong ?? []).map((w) => w.word)
      : (profile?.correct ?? []).map((w) => w.word);
  const showcase = showcaseWords(source);
  // 摆全了就直接冒号引出，没摆全才改口说「比如」。数字和牌对不上是最容易被
  // 当成 bug 的细节——文案报总数、牌只摆样本，用户一数就觉得少渲染了。
  const lead = showcase.length < source.length ? "，比如：" : "：";

  return (
    <div className="landing">
      {/* 账号是全局状态，不是「我现在要不要玩」的选项——所以放右上角常驻，
          和牌局里顶栏一个位置，别混进中间的行动区 */}
      <div className="landing-top">
        <button className="id-chip" onClick={onAccount}>
          {account?.bound ? (
            <>
              <span className="id-dot" aria-hidden="true" />
              {account.displayName}
            </>
          ) : (
            "登录 / 注册"
          )}
        </button>
      </div>

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

      {/* 一主一次：都是「进入这个游戏」的路径，一个去玩，一个先看怎么玩。
          次级动作用文字链而不是第二个方框，CTA 才保得住唯一性。
          放下方居中而不是并排右侧：上面 hero 全在一条中轴上，并排会让 CTA
          偏离轴心，看着像失误而不像设计。 */}
      <div className="landing-actions">
        <button className="btn btn-primary btn-cta" onClick={onStart}>
          ▶ 开始游戏
        </button>
        <button className="text-link" onClick={onRules}>
          完整规则 →
        </button>
      </div>

      {/* 复习卡：只有真攒下东西了才出现。新用户因此看到的是一个更干净的首页——
          一个动作，不做选择题；空的单词本点进去也是死路。
          牌是这个产品最独特的视觉资产，用它比再画一个通用统计卡有辨识度。 */}
      {(learned > 0 || toReview > 0) && (
        <div className="resume-card">
          {/* 句子必须交代清楚下面摆的是哪一组词——牌本身分不出对错，
              光写个数字，用户没法知道这几张是「已经会的」还是「漏掉的」 */}
          <p className="resume-stat">
            {toReview === 0 ? (
              <>
                你拼出过 <b>{learned}</b> 个词，一个都没漏{lead}
              </>
            ) : learned > 0 ? (
              <>
                你拼出过 <b>{learned}</b> 个词，还漏掉 <b>{toReview}</b> 个{lead}
              </>
            ) : (
              // 打完一局一个词都没拼出来的新手。只甩一个「还漏掉 N 个」，第一印象
              // 就是「你输了」——这是教学工具，不能这么迎接人。
              // 鼓励得说真话：「漏掉」在本游戏里的定义是**手里本来有牌却没看出来**
              // （RULES.md §9），不是「你不认识这个词」。把这点讲清楚比空喊加油有用，
              // 因为它确实成立：这些词本来就够得着。
              <>
                这 <b>{toReview}</b> 个词你手里本来有牌，只是没看出来——
                {/* 这一支不用通用的 lead：「下次就能拿下，比如：」里的「比如」
                    离它指代的名词太远，读着别扭，所以两种收尾各写一句 */}
                {showcase.length < source.length ? "先从这几个练起：" : "下次就能拿下："}
              </>
            )}
          </p>

          {showcase.length > 0 && (
            <div className="resume-words">
              {showcase.map((word) => (
                <span className="resume-word" key={word}>
                  {[...word].map((letter, i) => (
                    <Tile key={i} tile={letter} small />
                  ))}
                </span>
              ))}
            </div>
          )}

          {/* 百分位：和复习卡合并，不新增卡片——首页只有一个主动作，别再胖一圈。
              分母是**其他**玩家（见 db._percentile），文案不能省掉「其他」二字 */}
          {standing && standing.scorePercentile !== null && (
            <p className="resume-standing">
              平均分超过了 <b>{standing.scorePercentile}%</b> 的其他玩家
              {standing.wordRank && <> · 认识词数第 {standing.wordRank} 名</>}
            </p>
          )}

          <div className="resume-links">
            <button className="text-link resume-go" onClick={() => setShowProfile(true)}>
              打开单词本 →
            </button>
            <button className="text-link resume-go" onClick={() => setShowBoard(true)}>
              看排行榜 →
            </button>
          </div>
        </div>
      )}

      {showBoard && <Leaderboard onClose={() => setShowBoard(false)} />}

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

      <div className="landing-footer">
        <a
          className="footer-link"
          href="https://github.com/Bruce-pac/EnglishMahjong-web"
          target="_blank"
          rel="noopener noreferrer"
        >
          ⭐ 在 GitHub 上看源码
        </a>
        <span className="footer-dot">·</span>
        <a
          className="footer-link"
          href="https://github.com/Bruce-pac/EnglishMahjong-web/issues/new"
          target="_blank"
          rel="noopener noreferrer"
        >
          💬 提供反馈
        </a>
      </div>

      {showProfile && <Profile onClose={() => setShowProfile(false)} />}
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
/**
 * 点「开始游戏」之后去哪个页面（T7.1）。抽成纯函数是为了能单测——
 * 设置页里的点击本身没法测，vitest 跑在 node 环境、没有 DOM
 */
export function viewForStart(table: TableStyle): "table3d" | "classic" {
  return table === "3d" ? "table3d" : "classic";
}

export function Setup({
  onStart,
  onBack,
  defaultStyle,
}: {
  onStart: (c: MatchConfig, table: TableStyle) => void;
  onBack: () => void;
  /** 测试用：直接给默认样式。不传就按设备探测（P23） */
  defaultStyle?: TableStyle;
}) {
  const [c, setC] = useState<MatchConfig>(DEFAULTS);
  const set = (k: keyof MatchConfig, v: unknown) => setC({ ...c, [k]: v });
  // T7.1：牌桌样式。**不是 MatchConfig 的一部分**——服务端不认识它，不进开局请求。
  // 默认 3D，**故意不持久化**（用户 2026-09-22 定）：每次进设置页都从 3D 开始
  // P23：默认值随设备变——触屏或没有 WebGL 2 默认「经典」，其余 3D。
  // 惰性初始值：只在挂载时探测一次，别每次渲染都建 canvas
  const [table, setTable] = useState<TableStyle>(() => defaultStyle ?? defaultTableStyle(detectDevice()));
  // 自建词单：选了哪份、胡牌至少要几个词单词。只有「选了哪份」记进 localStorage（需求 §2.2）
  const [listId, setListId] = useState<number | null>(null);
  const [listNeed, setListNeed] = useState(1);
  // 不用词单时两个字段都不带——开局请求和改之前一字不差
  const startConfig = (): MatchConfig =>
    listId === null ? c : { ...c, wordListId: listId, listNeed };

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
          <div className="setup-group-label">牌桌样式</div>
          <Seg
            options={[
              ["3d", "3D 牌桌"],
              ["classic", "经典"],
            ]}
            value={table}
            onChange={(v) => setTable(v as TableStyle)}
          />
          <p className="setup-group-hint">3D 是立体牌桌，可以拖着牌重排；经典是平面版。只影响这一局，不记住。</p>
        </div>

        <div className="setup-group">
          <div className="setup-group-label">词库</div>
          <Seg options={TIERS as [string, string][]} value={c.tier} onChange={(v) => set("tier", v)} />
          <p className="setup-group-hint">加分和提示都围着这个词库转；AI 的词汇量也跟着它走。</p>
        </div>

        <WordListSetting
          listId={listId}
          need={listNeed}
          onChange={(id, need) => {
            setListId(id);
            setListNeed(need);
          }}
        />

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

        <button className="btn btn-primary btn-cta" onClick={() => onStart(startConfig(), table)}>
          ▶ 开始游戏
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const g = useGame();
  const [config, setConfig] = useState<MatchConfig | null>(null);
  /**
   * T7.1：在设置页选了 3D 时带过去的那份配置。`null` = 不是从设置页进来的
   * （`?view=3d` 直接打开、或带 `?match=` 刷新回来），那时 3D 页用它自己的默认配置
   */
  const [config3d, setConfig3d] = useState<MatchConfig | null>(null);
  // `?view=3d` 是 3D 页自己写进地址栏的（table3d/Table3D.tsx）：它和 2.5D 页共用
  // `?match=<id>`，没有这个标记的话，带牌局刷新会被下面的恢复逻辑拉回 2.5D 页
  const [view, setView] = useState<"landing" | "setup" | "rules" | "table3d">(() =>
    new URLSearchParams(window.location.search).get("view") === "3d" ? "table3d" : "landing",
  );
  /** 提示面板点的词：交给 Hand 铺好选牌，亮不亮玩家自己定 */
  const [hintPick, setHintPick] = useState<{ word: string; nonce: number } | null>(null);
  /**
   * 手牌区的字母大小写。**纯显示**——牌面数据、发给服务端的一切都不受影响。
   * 全大写的字母排在一起有时反而认不出单词（这正是玩家拼不出来的原因之一），
   * 所以让他随手切，并记进 localStorage：下一局、刷新后都照他的习惯来。
   */
  const [lowerHand, setLowerHand] = useState(
    () => localStorage.getItem("emj-hand-case") === "lower",
  );
  const toggleHandCase = () => {
    setLowerHand((on) => {
      localStorage.setItem("emj-hand-case", on ? "upper" : "lower");
      return !on;
    });
  };
  /** 音效开关。默认开，状态由 sound.ts 持有（它还要在播放前自查），这里只做镜像 */
  const [sound, setSound] = useState(() => !isMuted());
  /**
   * 发牌动画：开新局的那一瞬三家依次落牌，和发牌音效同步。
   * 只在这一小段时间内为真——常驻的话，对手每次摸牌新挂一张牌背都会跟着抖。
   * 窗口要比动画本身（最后一张约 860ms 落定，见 scene/Seat.tsx）留足余量，
   * 否则类被撤掉时最后几张牌会直接跳到终点。
   */
  const [dealing, setDealing] = useState(false);
  const gameNo = g.env?.state.gamesPlayed;
  const matchKey = g.env?.matchId;
  useEffect(() => {
    if (gameNo === undefined) return;
    setDealing(true);
    const t = window.setTimeout(() => setDealing(false), 1100);
    return () => clearTimeout(t);
  }, [gameNo, matchKey]);
  const toggleSound = () => {
    setMuted(sound);
    setSound(!sound);
  };
  /**
   * 账号登录态。null=还没查**或者查失败**；{bound:false}=确认是匿名。
   * 顶栏和结算页据此决定显示「登录」还是显示名。登录/注册成功后 onDone 直接更新，
   * 省一次往返。
   *
   * 查失败时必须留在 null，不能当成匿名：已登录的用户会看到「保存成绩」入口，
   * 一点就拿着已绑定的 playerId 去注册，撞回一句莫名其妙的「当前身份已经绑定过
   * 账号了」。null 时结算页不出这个入口，顶栏的入口也只开登录 tab（登录对两种
   * 身份都安全）。
   */
  const [account, setAccount] = useState<AccountState | null>(null);
  const [accountTab, setAccountTab] = useState<"register" | "login" | null>(null);
  useEffect(() => {
    api.accountMe().then(setAccount).catch(() => setAccount(null));
  }, []);
  // 登录态未知时一律走登录 tab，别诱导用户去注册
  const openAccount = () => setAccountTab(account && !account.bound ? "register" : "login");

  /**
   * 身份换代计数。登录、注册、退出登录都会让本地 playerId 指向另一份档案，
   * 而挂在档案上的界面（首页复习卡）自己看不见这件事——+1 就是通知它们重拉。
   * 用计数而不是把 account 对象当依赖：accountMe 首次落地也会换 account 的引用，
   * 那会白白多拉一次档案。
   */
  const [identityRev, setIdentityRev] = useState(0);
  /** 3D 页里打开的单词本 / 榜单（首页那两个是 Landing 自己的局部状态，3D 分支没有 Landing） */
  const [showProfile3d, setShowProfile3d] = useState(false);
  const [showBoard3d, setShowBoard3d] = useState(false);
  const bumpIdentity = () => setIdentityRev((n) => n + 1);

  // 刷新页面不该丢掉整局牌。URL 上带 ?match=<id> 就把它捞回来。
  // （测试脚本也靠它接管一局用 /api/dev/setup 摆好的牌。）
  const resume = g.resume;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("match");
    // 3D 页自己拉 envelope（T2.1），不走 useGame——那是 T5.2 的事
    if (id && params.get("view") !== "3d") {
      setConfig(DEFAULTS);
      resume(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 开局成功就把 matchId 写进地址栏——上面的恢复逻辑全靠它，否则刷新即弃局
  const matchId = g.env?.matchId;
  useEffect(() => {
    if (!matchId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("match") !== matchId) {
      url.searchParams.set("match", matchId);
      history.replaceState(null, "", url);
    }
  }, [matchId]);

  // 恢复失败（牌局已被回收 / 服务器重启过）：清掉失效参数回首页，
  // 不然每次刷新都对着一个不存在的牌局空转
  useEffect(() => {
    if (config && !g.busy && !g.env) {
      history.replaceState(null, "", window.location.pathname);
      setConfig(null);
    }
  }, [config, g.busy, g.env]);

  // 账号弹窗——首页和牌局里都可能打开，抽成共享元素避免每个分支重复
  const accountModal = accountTab && (
    <Account
      account={account}
      initialTab={accountTab}
      registerOnly={view === "table3d"}
      onClose={() => setAccountTab(null)}
      onDone={(displayName) => {
        setAccount({ bound: true, displayName });
        setAccountTab(null);
        bumpIdentity(); // 登录接管了别人的档案；注册虽是原地升级，白拉一次也无害
      }}
      onLogout={() => {
        setAccount({ bound: false });
        bumpIdentity(); // 退出＝换了个全新匿名身份，档案得跟着清空
      }}
    />
  );

  if (!config || !g.env) {
    if (view === "landing") {
      return (
        <>
          <Landing
            onStart={() => setView("setup")}
            onRules={() => setView("rules")}
            account={account}
            onAccount={openAccount}
            identityRev={identityRev}
          />
          {accountModal}
        </>
      );
    }
    if (view === "rules") {
      return <RulesPage onBack={() => setView("landing")} />;
    }
    if (view === "table3d") {
      // T6.6：3D 页的账号 / 单词本 / 榜单弹窗也由这里渲染——账号状态机只留一份，3D 只发请求。
      // 牌局中只能注册（registerOnly，见 Account 文件头）：注册原地升级身份、牌局归属不变
      return (
        <>
          <Suspense fallback={<div className="table3d-page" />}>
            <Table3D
              config={config3d}
              onBack={() => {
                // 3D 页往地址栏写了 ?match&view=3d，走的时候要擦掉——
                // 不擦的话回首页刷新又会被弹回 3D 页
                history.replaceState(null, "", window.location.pathname);
                setView("landing");
              }}
              account={account}
              onAccount={() => setAccountTab("register")}
              onProfile={() => setShowProfile3d(true)}
              onLeaderboard={() => setShowBoard3d(true)}
            />
          </Suspense>
          {accountModal}
          {showProfile3d && <Profile onClose={() => setShowProfile3d(false)} />}
          {showBoard3d && <Leaderboard onClose={() => setShowBoard3d(false)} />}
        </>
      );
    }
    return (
      <Setup
        onBack={() => setView("landing")}
        onStart={(c, table) => {
          if (viewForStart(table) === "table3d") {
            // 3D 页自己调 api 开局（总纲 §0 第 5 条：3D 不走 useGame），配置从这里传过去
            setConfig3d(c);
            setView("table3d");
            return;
          }
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
    <div className={lowerHand ? "app hand-lower" : "app"}>
      <header>
        <span className="brand">英语麻将</span>
        {/* 玩法开关常亮在顶栏——起胡门槛记不住的话，玩家会拿着不够门槛的牌
            白高兴。读服务端下发的 state.config：本地 config 在刷新恢复时是默认值 */}
        <span>
          词库 <b>{TIERS.find((t) => t[0] === state.config.tier)?.[1]}</b>
        </span>
        {/* 自建词单：够不够数由服务端数好（state.wordList），这里只显示。不用词单时整项不出 */}
        {state.wordList && (
          <span title={`胡牌时亮词和暗词里至少要有 ${state.wordList.need} 个词单词`}>
            词单 <b>{state.wordList.name}</b> · {listProgress(state.wordList)}
          </span>
        )}
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
        <button
          className="case-toggle"
          onClick={toggleHandCase}
          title="切换手牌区字母的大小写（只影响显示）"
        >
          字母 <b>{lowerHand ? "小写" : "大写"}</b>
        </button>
        <button className="case-toggle" onClick={toggleSound} title="打牌、吃牌、胡牌的音效">
          音效 <b>{sound ? "开" : "关"}</b>
        </button>
        <button
          className="case-toggle"
          onClick={openAccount}
          title={account?.bound ? "账号" : "登录 / 注册"}
        >
          {account?.bound ? <>👤 <b>{account.displayName}</b></> : "登录"}
        </button>
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

      <TableScene
        others={state.others}
        discards={state.discards}
        turn={state.turn}
        live={live}
        dealing={dealing}
        replay={g.replay}
      />

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
              onClick={() => setHintPick({ word: h.word, nonce: Date.now() })}
            >
              {h.word.toUpperCase()}
              {h.wild && <span className="wild-note">★={h.wild.toUpperCase()}</span>}
            </button>
          ))}
          <span className="hints-note">点一下替你选好牌，亮出还是收作暗词由你决定；用提示的词会被标记「被提示」</span>
        </div>
      )}

      {/* 胡牌退出后，手牌区换成观战条——否则界面一片死寂，
          你连自己在等什么都不知道，还以为卡死了 */}
      {me.won ? (
        <Spectating
          me={me}
          others={state.others}
          bloody={state.config.bloody}
          finished={state.finished}
          onSkip={
            canSkipReplay({
              bloody: state.config.bloody,
              meWon: me.won,
              replaying: g.replaying,
              stillPlaying: state.others.filter((o) => !o.won).length,
            })
              ? g.skipReplay
              : undefined
          }
        />
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
        hintPick={hintPick}
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
              {g.celebrate.seat === 0 ? "你" : AI_NAMES[g.celebrate.seat ?? 0]}
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
          canSave={account !== null && !account.bound}
          onSave={() => setAccountTab("register")}
          onNext={g.nextGame}
          onRestart={() => {
            history.replaceState(null, "", window.location.pathname);
            setConfig(null);
          }}
        />
      )}
      {accountModal}
    </div>
  );
}
