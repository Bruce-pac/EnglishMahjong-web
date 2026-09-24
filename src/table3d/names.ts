/**
 * 三个 AI 的显示名字（按座位号）：
 *
 *   下家 Jean　对家 Loyce　上家 Loura
 *
 * （拼写就是这样，不是 Laura / Joyce。用户 2026-09-24 定。）
 *
 * **故意不和 2.5D 的 `src/aiNames.ts` 同步**：那边仍是中文名，2.5D 以后要删，不值得为它改；
 * 3D 的名字要印在桌沿名牌上（P4），英文名短、竖排也放得下。另外 3D 本来就自带一份：
 * - 3D 不依赖 2.5D 的模块
 * - 懒加载的 3D chunk 一旦 import 主包里的模块，打包器就得让主包多导出一个绑定，主包会变大（T6.3 实测 205.00 → 205.01 kB）
 */
export const AI_NAMES: Readonly<Record<number, string>> = {
  1: "Jean",
  2: "Loyce",
  3: "Loura",
};
