/**
 * 三个 AI 的显示名字——纯前端文案，和座位号对应的性格彩蛋
 * （server/session.py 的 AI_STYLES）：
 *
 *   上家 胡一菲——亮牌流，能亮就亮
 *   对家 诸葛大力——长词流，只亮 ≥5 字母的词
 *   下家 张益达——门清流，一个词都不亮，全押暗词
 */
export const AI_NAMES: Record<number, string> = {
  3: "胡一菲",
  2: "诸葛大力",
  1: "张益达",
};
