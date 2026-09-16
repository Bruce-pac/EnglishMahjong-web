/**
 * T2.3a：右上角的玩法配置条。图标常驻，鼠标悬停或键盘聚焦时展开。
 *
 * **为什么常亮**：起胡门槛记不住的话，玩家会拿着不够门槛的牌白高兴（同 2.5D 顶栏，`App.tsx:634`）。
 *
 * **展开只用 CSS 的 `:hover` / `:focus-within`，不用 JS 状态**：vitest 跑在 node 环境、
 * 没有真 DOM，测不了 hover；用 CSS 的话浏览器实测覆盖得到，也不会卡在展开状态。
 *
 * 词库名和 2.5D 的 `App.tsx` 里那份相同，但 3D 故意自带一份，理由同 `names.ts`：
 * 3D 不依赖 2.5D 的模块（2.5D 以后要删），而且懒加载的 3D chunk 一旦 import 主包里的模块，
 * 打包器就得让主包多导出一个绑定，主包会变大。
 */

import type { State } from "../api";

/** 词库档位的中文名。与 `App.tsx` 的 TIERS 同内容，各存各的 */
const TIER_NAMES: Readonly<Record<string, string>> = {
  junior: "初中",
  senior: "高中",
  cet4: "四级",
  cet6: "六级",
  kaoyan: "考研",
  toefl: "托福",
  gre: "GRE",
};

const DIFFICULTY_NAMES: Readonly<Record<string, string>> = {
  easy: "简单",
  normal: "普通",
  hard: "困难",
};

/** 配置条要显示的六项。纯函数，单测钉着文案 */
export function configRows(config: State["config"]): Array<{ label: string; value: string; title?: string }> {
  return [
    { label: "词库", value: TIER_NAMES[config.tier] ?? config.tier },
    { label: "难度", value: DIFFICULTY_NAMES[config.difficulty] ?? config.difficulty },
    { label: "词长", value: `≥${config.minWordLen}`, title: "拼出的词至少要几个字母" },
    {
      label: "起胡",
      value: config.minWinWordLen ? `≥${config.minWinWordLen}` : "关",
      title: "胡牌时手上至少要有一个这么长的词",
    },
    {
      label: "血战",
      value: config.bloody ? "开" : "关",
      title: "开：先胡的退出，其余人继续；关：第一人胡牌本局即结束",
    },
    { label: "提示", value: config.hints ? "开" : "关", title: "开：轮到你时可以看服务端给的候选词" },
  ];
}

/**
 * 数据只来自服务端下发的 `state.config`——本地那份在刷新恢复时是默认值，不可信。
 *
 * `onPeek`：鼠标移进来（或键盘聚焦）时通知调用方。右上角同一个角落里还有 ⚙ 面板，
 * 两张同时展开会叠在一起、字互相压着（审查实测重叠约 86px），所以这里一展开就让 ⚙ 收起。
 */
export function ConfigBar({ config, onPeek }: { config: State["config"] | null; onPeek?: () => void }) {
  if (!config) return null;
  return (
    <div
      className="table3d-config"
      tabIndex={0}
      role="group"
      aria-label="本场玩法"
      onMouseEnter={onPeek}
      onFocus={onPeek}
    >
      <span className="table3d-config-icon" aria-hidden="true">
        ⓘ
      </span>
      <div className="table3d-config-panel">
        {configRows(config).map((row) => (
          <div className="table3d-config-row" key={row.label} title={row.title}>
            <span className="table3d-config-label">{row.label}</span>
            <b>{row.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
