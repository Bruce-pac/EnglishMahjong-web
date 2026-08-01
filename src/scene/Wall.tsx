/**
 * 一家 AI 的牌墙——**一整堵墙画成一个长盒子**，不是 N 张牌各画各的。
 *
 * 为什么不用 CSS 3D：牌桌的相机是固定的，没必要真做 3D。第一版用 preserve-3d
 * 把四个 DOM 面折成盒子，结果白绿比例是「牌尺寸 × 后仰角 × 透视」凑出来的副产品，
 * 调一个坏一个，接缝还对不齐、圆角会断。改成 SVG 直接按这个固定视角画：
 * 比例是我给的数，圆角、倒角、凹槽都画得出来。
 *
 * 实物关系（RULES 之外的美术约定，用户逐条确认过）：
 *   · 牌立在桌上，牌面朝**它自己的主人**，所以我们（南）看到的是三家的绿背。
 *   · 牌＝象牙白牌身 + 背面一层绿背板；白比绿厚，绿只在最外一层。
 *   · 一堵墙里，只有**最靠南**那张露得出白侧面，其余的侧面都被邻牌挡住——
 *     所以整堵墙视觉上就是一个长盒子，中间的牌缝只是划线。
 */

/** 一张牌的尺寸口径：长（正面上下）: 宽（正面左右）: 厚（前后深度）= 40 : 30 : 21 */
const H = 40;
const W = 30;
const T = 21;

/**
 * 进深压缩系数。竖直方向不压缩（牌立着，牌长 40 就是屏幕上的 40px），
 * 往桌子里走的方向压到 79%——取 cos(38°)，和 .table-surface 的 rotateX(38deg) 对齐，
 * 否则墙和桌面看着不是一个透视。
 */
const F = 0.79;

/**
 * 横向剪切：纯轴测投影下，南北走向的两堵侧墙在屏幕上会是**完全垂直**的，
 * 绿背面正好侧对视线、塌成一条线（实测过）。给一点收敛就有立体感了。
 * 取值要让墙和**桌子的侧边平行**：桌边斜率约 0.33，乘每张牌的步进 23.7 ≈ 8。
 * 不平行的话墙会一头在桌内、一头骑到木边上。
 */
const SHEAR = 8;

/**
 * 消失点离墙的竖直距离。牌墙里每张牌的进深方向都指向这个点，而不是各自平行——
 * 平行的话（整堵墙共用一个矩阵）左右两端的牌斜向一模一样，一眼就假。
 * 数越小收敛越猛；牌桌两条侧边的消失点比这个近得多，所以墙的收敛要更缓。
 */
const VANISH = 520;

/** 绿背板占牌厚度的比例，其余是白牌身——白比绿厚 */
const GREEN = 0.34;
/** 牌的圆角 */
const R = 3.5;

export type WallPose = "far" | "left" | "right";

/** 每种方位的两个方向向量：N＝沿墙每张牌的位移，E＝厚度方向的位移 */
function vectors(pose: WallPose): { N: [number, number]; E: [number, number] } {
  const depth = T * F; // 厚度落在进深方向时的屏幕长度
  const pitch = W * F; // 宽度落在进深方向时的屏幕长度（侧墙每张的步进）
  if (pose === "far") {
    // 对家：沿东西排（宽度不压缩），厚度朝北（进深，压缩）。
    // 基准进深是**竖直**的——对家正对着我们，墙中点那张牌不该偏；
    // 左右两端的偏移由 depthAt() 按消失点逐张算，才会对称收敛。
    return { N: [W, 0], E: [0, -depth] };
  }
  if (pose === "left") {
    // 上家：沿南北排（宽度落在进深上），墙体朝西（东西向，不压缩）
    return { N: [SHEAR, -pitch], E: [-T, -5] };
  }
  // 下家：上家的镜像
  return { N: [-SHEAR, -pitch], E: [T, -5] };
}

interface Props {
  pose: WallPose;
  /** 这家手上有几张牌——墙的长度跟着它走 */
  count: number;
  /** 正在发牌：牌沿墙逐张落位 */
  dealing: boolean;
  /** 这家在舞台上的落点（百分比），墙从这里往里长 */
  style?: React.CSSProperties;
}

export function Wall({ pose, count, dealing, style }: Props) {
  const { N, E } = vectors(pose);
  const n = Math.max(0, Math.min(count, 14));
  if (n === 0) return null;

  // 每张牌各自一个矩阵：进深方向指向消失点，所以左右两端的牌是斜的、
  // 越靠边斜得越厉害——这就是透视。整堵墙共用一个矩阵的话它们会完全平行。
  const mat = (ax: number, ay: number, cx: number, cy: number, ox = 0, oy = 0) =>
    `matrix(${ax} ${ay} ${cx} ${cy} ${ox} ${oy})`;
  // 墙的中点（局部坐标）：进深方向朝它上方的消失点收敛
  const mid = (n * (pose === "far" ? W : 0)) / 2;
  /** 第 i 张牌的进深向量：横向分量随它离中点的距离线性变化 */
  const depthAt = (i: number): [number, number] => {
    if (pose !== "far") return E; // 侧墙本身就是沿进深方向排的，不再叠加收敛
    const cx = mid - (i + 0.5) * W;      // 这张牌到中点的横向距离
    return [E[0] + (cx * -E[1]) / VANISH, E[1]];
  };

  // 绿背面不含进深，所有牌共用一个矩阵：局部 x 沿墙、y 向下
  const faceM = mat(N[0] / W, N[1] / W, 0, 1);

  // 对家那堵墙要按张数居中：墙从最左那张往右长，长度随手牌数变。
  // 居中量画在 SVG **内部**——CSS 的 transform 要留给窄屏缩放用，
  // 而且 translateX(-50%) 只会按 svg 的 1px 宽度算，起不到作用。
  const center = pose === "far" ? `translate(${(-n * W) / 2} 0)` : "";

  const tiles = Array.from({ length: n }, (_, i) => i);
  const delay = (i: number) => (dealing ? { animationDelay: `${i * 26}ms` } : undefined);

  return (
    <svg className={`wall wall-${pose} ${dealing ? "dealing" : ""}`} style={style} aria-hidden="true">
      {/* 渐变必须在 SVG 里定义（fill 吃不了 CSS 变量）。三堵墙用同一套 id，
          重复定义浏览器取第一个，内容一样所以无所谓。 */}
      <defs>
        <linearGradient id="wallBack" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#57bd37" />
          <stop offset=".18" stopColor="#41a626" />
          <stop offset=".72" stopColor="#2c8317" />
          <stop offset="1" stopColor="#1c6210" />
        </linearGradient>
        <linearGradient id="wallTop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffefa" />
          <stop offset=".5" stopColor="#f6efdf" />
          <stop offset="1" stopColor="#dfd3b8" />
        </linearGradient>
        <linearGradient id="wallCap" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffefa" />
          <stop offset="1" stopColor="#d9cdb1" />
        </linearGradient>
        <linearGradient id="wallRim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#46ab29" />
          <stop offset="1" stopColor="#2a7c17" />
        </linearGradient>
      </defs>
      <g transform={center}>
        {/* 一张牌 = 一个 <g class="wall-tile">，**外层只挂动画、不带 transform**。
            SVG 里 CSS 的 transform 会**覆盖**元素的 transform 属性——顶面那些组
            身上带着投影矩阵，动画一跑矩阵就被顶掉，牌会散成绿背和白顶两半各飞各的
            （用户实测反馈）。所以矩阵一律放在内层的组上。

            画的顺序：**从最远那张往近处画**，近的压住远的（画家算法）。
            一张牌内部先画顶面再画正面，正面离我们更近。 */}
        {[...tiles].reverse().map((i) => {
          const d = depthAt(i);
          const x = i * W;
          // 顶面：沿墙方向 + 自己那张的进深方向，原点抬到墙顶（离地 H）
          const topM = mat(N[0] / W, N[1] / W, d[0] / T, d[1] / T, 0, -H);
          return (
            <g key={i} className="wall-tile" style={delay(i)}>
              <g transform={topM}>
                <rect x={x + 0.4} y={0} width={W - 0.8} height={T} rx={R * 0.6} fill="url(#wallTop)" />
                {/* 绿背板在牌顶露出的那一条 */}
                <rect x={x + 0.4} y={0} width={W - 0.8} height={T * GREEN} rx={R * 0.5} fill="url(#wallRim)" />
              </g>

              <g transform={faceM}>
                <rect x={x + 0.5} y={-H} width={W - 1} height={H} rx={R} fill="url(#wallBack)" />
                {/* 倒角：上沿受光一道亮边、下沿一道暗边 */}
                <rect x={x + 2.5} y={-H + 1.6} width={W - 5} height={3} rx={1.5} fill="#8ad76a" opacity=".5" />
                <rect x={x + 2} y={-4} width={W - 4} height={3} rx={1.5} fill="#0d5b0a" opacity=".28" />
                {/* 牌缝：一暗一亮两条，像两张牌之间的凹槽，不是一条黑线 */}
                {i > 0 && (
                  <>
                    <rect x={x - 0.9} y={-H} width={1.4} height={H} fill="#0e3d09" opacity=".5" />
                    <rect x={x + 0.6} y={-H} width={1} height={H} fill="#6cc44d" opacity=".33" />
                  </>
                )}
              </g>

              {/* 南端盖：只有最靠南那张露得出来的白侧面，跟着这张牌一起落。
                  **只有侧墙有**：对家墙正对着我们，它左右两个端面都朝外背着我们，
                  本来就看不见；照着侧墙画的话会盖在最左那张的绿背边上，
                  看着像绿背透明、透出了侧面（用户实测反馈）。 */}
              {i === 0 && pose !== "far" && (
                <g transform={mat(d[0] / T, d[1] / T, 0, 1)}>
                  <rect x={0.4} y={-H} width={T - 0.8} height={H} rx={R} fill="url(#wallCap)" />
                  <rect x={0.4} y={-H} width={T * GREEN} height={H} rx={R * 0.6} fill="url(#wallRim)" />
                </g>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
