/**
 * 用真实浏览器打完一局，验证整条链路：
 * 点选拼词 → 组暗词 → 打牌 → AI 行动 → 胡牌/荒牌 → 结算页 → 错题集。
 *
 * 这里的"玩家"故意只会拼简单短词，好让散牌区留下东西——错题集才有内容可揪。
 * 若它永远是空的，说明求解器又在替玩家拆牌了（见 server/engine.py 的注释）。
 *
 *   node playthrough.mjs
 */
import { chromium } from "playwright";

const OUT = process.env.OUT ?? "/tmp";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// 循环里大量「元素可能不存在」的探测都靠 .catch 兜底，若用默认 30s 超时，
// 观战/等待阶段每轮都得干等半分钟，80 轮循环能拖上几小时
page.setDefaultTimeout(2500);

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// 服务端拒了什么？400 的 detail 才是真信息，控制台里只看得到「400 Bad Request」
const rejects = [];
page.on("response", async (r) => {
  if (r.status() === 400) {
    const body = await r.json().catch(() => ({}));
    rejects.push(body.detail ?? "?");
  }
});

// 5173 被占时 vite 会换端口，BASE 环境变量跟着指过去
await page.goto(process.env.BASE ?? "http://localhost:5173");
// 首页只是门面，配置在第二步的设置页里
await page.click(".landing button:has-text('开始游戏')");
await page.click(".seg-btn:has-text('≥6')"); // 起胡门槛 ≥6，否则牌局太快
await page.click(".setup-card button:has-text('开始游戏')");
await page.waitForTimeout(1200);

const clickable = (sel) => page.locator(sel).first();

for (let turn = 0; turn < 80; turn++) {
  if (await page.locator(".sheet").isVisible().catch(() => false)) break;

  // 能胡就胡
  if (await clickable("button:has-text('胡牌')").isVisible().catch(() => false)) {
    await clickable("button:has-text('胡牌')").click();
    await page.waitForTimeout(900);
    continue;
  }

  const prompt = await page.locator(".prompt b").textContent().catch(() => "");

  // 「出牌」和「亮词」都走打牌路径——亮词阶段直接打牌就是放弃亮词，
  // 「过」按钮只剩吃/胡决策才有（测试bug.md）
  if (prompt?.includes("出牌") || prompt?.includes("亮词")) {
    // 先试着把散牌凑成词（贪心地试相邻三张）。
    // 每轮都要重新数散牌——组成暗词后牌会从散牌区消失，用旧的张数会点到不存在的元素。
    for (let i = 0; i < 6; i++) {
      const tiles = page.locator(".hand-tiles .tile");
      const n = await tiles.count();
      if (i + 2 >= n) break;

      await tiles.nth(i).click();
      await tiles.nth(i + 1).click();
      await tiles.nth(i + 2).click();
      await page.waitForTimeout(250);

      const ok = await clickable("button:has-text('组成暗词')").isVisible().catch(() => false);
      if (ok) {
        await clickable("button:has-text('组成暗词')").click();
        await page.waitForTimeout(500);
        break;
      }
      await clickable("button:has-text('取消')").click().catch(() => {});
    }

    // 散牌区可能被自己组空了——那就得先拆一个暗词，否则没牌可打
    if ((await page.locator(".hand-tiles .tile").count()) === 0) {
      await page.locator(".hand-words .word").first().click();
      await page.waitForTimeout(500);
    }

    // 打出第一张**不是白搭**的散牌。散牌是排序的，白搭（★）恰好排最前——
    // 盲点第一张的话，手里一有白搭就会永远点到它、永远打不出去，整局卡死。
    // （散牌只剩白搭的死局例外里，界面本来就放行，这时退回点第一张。）
    const nonWild = page.locator(".hand-tiles .tile:not(:has-text('★'))");
    const target = (await nonWild.count()) > 0 ? nonWild.first() : page.locator(".hand-tiles .tile").first();
    await target.click();
    await page.waitForTimeout(200);
    const discard = clickable("button:has-text('打出这张')");
    if (await discard.isVisible().catch(() => false)) {
      await discard.click();
    } else {
      await clickable("button:has-text('取消')").click().catch(() => {});
    }
    await page.waitForTimeout(1100);
  } else if (await clickable("button:has-text('过')").isVisible().catch(() => false)) {
    await clickable("button:has-text('过')").click();
    await page.waitForTimeout(900);
  } else {
    await page.waitForTimeout(600);
  }
}

await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/4-scoreboard.png`, fullPage: true });

const sheet = await page.locator(".sheet").textContent().catch(() => null);
if (sheet) {
  console.log("✓ 打到了结算页");
  const missed = await page.locator(".profile-bad").textContent().catch(() => null);
  console.log(missed ? "✓ 错题集有内容: " + missed.replace(/\s+/g, " ").trim() : "· 这一局没有错题");
} else {
  console.log("✗ 没走到结算页");
}

if (rejects.length) {
  const counts = {};
  rejects.forEach((r) => (counts[r] = (counts[r] ?? 0) + 1));
  console.log("\n服务端拒绝了这些请求:");
  Object.entries(counts).forEach(([msg, n]) => console.log(`   ×${n}  ${msg}`));
} else {
  console.log("\n✓ 服务端没拒绝任何请求");
}
console.log(errors.length ? "!! JS 报错:\n  " + errors.slice(0, 5).join("\n  ") : "✓ 无 JS 报错");
await browser.close();
