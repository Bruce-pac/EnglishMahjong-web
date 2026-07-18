/**
 * 详细规则页。内容以 RULES.md 为准——这里只做「玩家读得下去」的转述，
 * 数字（张数、分值、加成）一律照抄规格书，不得自创。
 */

export function RulesPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="rules-page">
      <div className="setup-top">
        <button className="btn btn-ghost" onClick={onBack}>
          ← 返回首页
        </button>
        <h1>游戏规则</h1>
      </div>

      <section className="rule-section">
        <div className="rule-head">
          <div className="feature-icon feature-icon-green">🀄</div>
          <h2>基本规则</h2>
        </div>

        <div className="rule-sub">
          <h3>游戏目标</h3>
          <p>
            摸牌、打牌，把手里的字母牌拼成英语单词。最先把 <b>14 张预算</b>用单词完整填满（零剩余）的玩家胡牌。
            全场只有一个追求：<b>多组词、组长词</b>。
          </p>
        </div>

        <div className="rule-sub">
          <h3>牌组构成</h3>
          <p>
            共 <b>108 张</b>：104 张字母牌 + 4 张白搭。字母按它在英文单词里出现的概率配张——
            E、I、O、T 各 8 张，J、Q、X、Z 这类稀缺字母只有 2 张。<b>红色是元音，黑色是辅音</b>。
            白搭分元音白搭 ×2（只能代 A/E/I/O/U）和辅音白搭 ×2（只能代 21 个辅音），
            而且<b>不许打出</b>——它是全场最灵活的牌，打掉是纯浪费。
            牌角的小数字（A=1 … Z=26）只是帮你记字母表位置的教学标注，和分值无关。
          </p>
        </div>

        <div className="rule-sub">
          <h3>游戏流程</h3>
          <ol>
            <li>每人 13 张起手，庄家先行。</li>
            <li>轮到你：摸一张 →（可选择亮词）→ 打出一张，手牌张数恒定。</li>
            <li>你打出的牌，只有下家可以吃。</li>
            <li>牌墙摸完仍无人胡，本局荒牌结束。</li>
          </ol>
        </div>
      </section>

      <section className="rule-section">
        <div className="rule-head">
          <div className="feature-icon feature-icon-blue">⚡</div>
          <h2>核心操作</h2>
        </div>

        <div className="rule-grid">
          <div className="rule-card">
            <h3>摸牌 / 打牌</h3>
            <p>轮到你先从牌墙摸一张，然后打出一张最没用的。打出的牌进牌河，收不回来。</p>
          </div>
          <div className="rule-card">
            <h3>亮词</h3>
            <p>
              把拼好的 ≥3 字母单词摊在桌上。亮词无论多长<b>只占 3 格预算</b>，
              还能<b>补摸「词长 − 3」张</b>牌；代价是一经亮出永久冻结，不能拆改。
            </p>
          </div>
          <div className="rule-card">
            <h3>吃牌</h3>
            <p>
              上家打出的牌你可以吃，但必须<b>当场</b>和手里的牌拼成 ≥3 字母的词亮出，
              不能白拿进手。吃完照样要打出一张。
            </p>
          </div>
          <div className="rule-card">
            <h3>暗词</h3>
            <p>
              拼好的词也可以扣在手里不亮——不冻结、随时拆开重组，按<b>实际字母数</b>占预算。
              难度大得多，所以结算时<b>得分 ×2</b>。
            </p>
          </div>
        </div>
      </section>

      <section className="rule-section">
        <div className="rule-head">
          <div className="feature-icon feature-icon-gold">🏆</div>
          <h2>胡牌与计分</h2>
        </div>

        <div className="rule-sub">
          <h3>胡牌条件</h3>
          <p>
            14 张预算被单词完整填满、<b>零剩余</b>。每个亮词占 3 格，暗词按实际字母数占格，
            所以最多亮 4 个词。开局可以设「起胡门槛」：胡牌时手上至少要有一个 ≥N 字母的词。
          </p>
        </div>

        <div className="rule-sub">
          <h3>计分</h3>
          <p>
            字母分值看稀有度：8、6 张的字母 <b>1 分</b>，4 张的 <b>2 分</b>，2 张的 <b>3 分</b>，
            白搭 0 分但算词长。<b>单词得分 =（字母分之和）× 词长</b>——
            CAT 12 分，WORD 32 分，ELEPHANT 96 分，词越长涨得越狠。
          </p>
          <p>
            加成：暗词 <b>×2</b>；命中本局词库 <b>+10</b>；血战到底下先胡有名次奖励
            <b>+50 / +30 / +10</b>。
          </p>
        </div>

        <div className="rule-sub">
          <h3>血战到底</h3>
          <p>默认开启：先胡的玩家退出，其余人继续打，直到牌墙摸完。关闭则第一人胡牌本局立即结束。</p>
        </div>
      </section>

      <section className="rule-section">
        <div className="rule-head">
          <div className="feature-icon feature-icon-orange">💡</div>
          <h2>小技巧</h2>
        </div>

        <div className="rule-grid">
          <div className="rule-card">
            <h3>效率流还是高分流</h3>
            <p>亮词换预算、换补摸，推进快；暗词占满预算、结算 ×2。两条路线怎么配，就是这个游戏的策略核心。</p>
          </div>
          <div className="rule-card">
            <h3>元音是硬通货</h3>
            <p>几乎每个单词都要元音。散牌里一个元音都没有的时候，再多辅音也拼不出词。</p>
          </div>
          <div className="rule-card">
            <h3>长词的平方红利</h3>
            <p>得分乘词长，BEAUTIFUL 一个词 135 分，抵得上一堆短词。看到长词苗子别急着拆。</p>
          </div>
          <div className="rule-card">
            <h3>白搭省着用</h3>
            <p>白搭替 Q、X、Z 这类稀缺字母最划算。记住它不能打出——别让用不上的白搭堵在手里。</p>
          </div>
        </div>
      </section>

      <section className="rule-section">
        <div className="rule-head">
          <div className="feature-icon feature-icon-gray">❓</div>
          <h2>常见问题</h2>
        </div>

        <div className="rule-sub">
          <h3>系统会告诉我能拼什么词吗？</h3>
          <p>
            不会。系统只当裁判：你点选了哪几张，它只回答「这是不是一个词」。
            想要候选词，开局时打开「提示」——但用了提示的词会在单词本里留下「被提示」的印记。
          </p>
        </div>
        <div className="rule-sub">
          <h3>词库档位影响什么？</h3>
          <p>
            影响加分（命中词库 +10）、提示范围和 AI 的词汇量。判定单词合不合法用的是 17 万词的大词典，
            词库外的合法单词照样能亮、能胡，只是没有词库加分。
          </p>
        </div>
        <div className="rule-sub">
          <h3>单词本记什么？</h3>
          <p>每局结束自动记录你拼出的词和漏掉的词，带音标、释义、朗读，跨场次一直累积。</p>
        </div>
        <div className="rule-sub">
          <h3>需要网络吗？</h3>
          <p>词典、规则、AI 全在服务端本地完成，游戏进行中不依赖任何外部服务。</p>
        </div>
      </section>

      <div className="rules-page-bottom">
        <button className="btn btn-primary btn-cta" onClick={onBack}>
          返回首页
        </button>
      </div>
    </div>
  );
}
