/**
 * AI 玩家的卡通形象。
 *
 * 三个形象按座位固定，性格对上 server/session.py 的 AI_STYLES（见 aiNames.ts）：
 *
 *   上家 胡一菲（亮牌流，能亮就亮）  → 狐狸，张扬
 *   对家 诸葛大力（长词流，只亮长词）→ 熊猫，稳重
 *   下家 张益达（门清流，一个词不亮）→ 兔子，闷声不响
 *
 * 全部用 inline SVG 画：矢量无损、不加一个字节的图片资源，也不引图形库
 * （课堂网络不可靠，运行时零外部依赖是全项目的红线）。
 * 表情状态用 CSS 类切换，眨眼/思考/喊话的动作都在 scene.css 里。
 */

/** 形象当下的状态——由牌局事件推出来，见 moodOf() */
export type Mood = "idle" | "thinking" | "discard" | "call" | "win";

/** 每个形象的配色：主体 / 深色（耳朵内侧、纹样）/ 腮红 */
const SKINS: Record<number, { body: string; dark: string; blush: string; ear: string }> = {
  3: { body: "#e08a4a", dark: "#b9662f", blush: "#f4b98d", ear: "#fdf3e6" }, // 狐狸
  2: { body: "#f4f1ea", dark: "#2f3336", blush: "#f0c0bd", ear: "#2f3336" }, // 熊猫
  1: { body: "#f0e6e6", dark: "#cba9a9", blush: "#f2bcbc", ear: "#f7d3d8" }, // 兔子
};

/** 三家的耳朵形状——只有耳朵不同就足够辨认，身体共用一套 */
function Ears({ seat, skin }: { seat: number; skin: (typeof SKINS)[number] }) {
  if (seat === 3) {
    // 狐狸：尖立耳
    return (
      <>
        <path d="M16 30 L10 6 L32 20 Z" fill={skin.body} />
        <path d="M18 28 L14 13 L28 22 Z" fill={skin.ear} />
        <path d="M64 30 L70 6 L48 20 Z" fill={skin.body} />
        <path d="M62 28 L66 13 L52 22 Z" fill={skin.ear} />
      </>
    );
  }
  if (seat === 2) {
    // 熊猫：圆黑耳
    return (
      <>
        <circle cx="18" cy="20" r="11" fill={skin.ear} />
        <circle cx="62" cy="20" r="11" fill={skin.ear} />
      </>
    );
  }
  // 兔子：长垂耳
  return (
    <>
      <ellipse cx="26" cy="14" rx="7" ry="19" fill={skin.body} />
      <ellipse cx="26" cy="15" rx="3.5" ry="14" fill={skin.ear} />
      <ellipse cx="54" cy="14" rx="7" ry="19" fill={skin.body} />
      <ellipse cx="54" cy="15" rx="3.5" ry="14" fill={skin.ear} />
    </>
  );
}

interface Props {
  seat: number;
  mood: Mood;
}

export function Avatar({ seat, mood }: Props) {
  const skin = SKINS[seat] ?? SKINS[2];
  // 赢了就闭眼笑，其余状态都睁眼（眨眼由 CSS 动画负责）
  const smiling = mood === "win" || mood === "call";

  return (
    <div className={`avatar avatar-${mood}`}>
      <svg viewBox="0 0 80 80" width="72" height="72" aria-hidden="true">
        <Ears seat={seat} skin={skin} />

        {/* 脸 */}
        <ellipse cx="40" cy="46" rx="29" ry="26" fill={skin.body} />

        {/* 熊猫的黑眼圈——形象辨识度全靠它 */}
        {seat === 2 && (
          <>
            <ellipse cx="29" cy="43" rx="9" ry="10" fill={skin.dark} />
            <ellipse cx="51" cy="43" rx="9" ry="10" fill={skin.dark} />
          </>
        )}

        {/* 眼睛。闭眼＝一条弯线，睁眼＝黑豆＋高光；.avatar-eye 挂眨眼动画 */}
        {smiling ? (
          <>
            <path d="M23 43 Q29 38 35 43" stroke={skin.dark} strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M45 43 Q51 38 57 43" stroke={skin.dark} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <g className="avatar-eyes">
            <circle cx="29" cy="44" r="4.2" fill="#22282b" />
            <circle cx="51" cy="44" r="4.2" fill="#22282b" />
            <circle cx="30.4" cy="42.6" r="1.4" fill="#fff" />
            <circle cx="52.4" cy="42.6" r="1.4" fill="#fff" />
          </g>
        )}

        {/* 腮红 */}
        <ellipse cx="19" cy="52" rx="5" ry="3.2" fill={skin.blush} opacity="0.75" />
        <ellipse cx="61" cy="52" rx="5" ry="3.2" fill={skin.blush} opacity="0.75" />

        {/* 鼻子 + 嘴。喊话/赢了张嘴，其余闭嘴 */}
        <ellipse cx="40" cy="52" rx="3.4" ry="2.6" fill={skin.dark} />
        {mood === "call" || mood === "win" ? (
          <ellipse cx="40" cy="60" rx="6" ry="5" fill="#8f4a4a" />
        ) : (
          <path d="M34 58 Q40 62 46 58" stroke={skin.dark} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        )}
      </svg>
    </div>
  );
}

/** 喊话气泡的文案；null＝这个状态不冒泡 */
export function bubbleFor(mood: Mood): string | null {
  if (mood === "call") return "吃！";
  if (mood === "win") return "胡了！";
  if (mood === "thinking") return "…";
  return null;
}
