/**
 * 三个 AI 的显示名字（按座位号），与 `server/session.py` 的 AI_STYLES 的性格彩蛋对应：
 *
 *   上家 胡一菲——亮牌流　对家 诸葛大力——长词流　下家 张益达——门清流
 *
 * 和 2.5D 的 `src/aiNames.ts` 内容相同，但 3D 故意自带一份：
 * - 3D 不依赖 2.5D 的模块（2.5D 以后要删）
 * - 懒加载的 3D chunk 一旦 import 主包里的模块，打包器就得让主包多导出一个绑定，主包会变大（T6.3 实测 205.00 → 205.01 kB）
 */
export const AI_NAMES: Readonly<Record<number, string>> = {
  1: "张益达",
  2: "诸葛大力",
  3: "胡一菲",
};
