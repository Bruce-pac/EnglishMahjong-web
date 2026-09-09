import { Euler, Quaternion, Vector3 } from "three";
import {
  DISCARD_COLS,
  DISCARD_ROWS,
  LOOSE_SLOTS,
  MELD_ROWS,
  meldSlots,
  WALL_LAYERS,
  WALL_STACKS_OTHER,
  WALL_STACKS_PLAYER,
  WORLD_SIZE,
} from "./layout";
import { Slot } from "./slot";
import { Size, ThingType } from "./types";

/**
 * 英语麻将的桌面布局（需求文档 §3）。
 *
 * 只为 **0 号座位**（屏幕下方，面朝 +y）定义一次，其余三家绕桌心转 90°/180°/270°
 * 复制出来。坐标系：桌面 0..174 见方，z 向上，牌面朝 +z。
 *
 * 0 号座位从桌沿往桌心排开（次序照真牌桌与 Autotable：手牌 → 牌墙 → 牌河 → 桌心；
 * 亮词区在右手边，与牌墙同深度、在 x 上错开）：
 *
 * ```
 *   y  0.. 9   loose    散牌区，一整排 18 格居中 x 57..165（余量左右各 2 格）
 *   y  9..45   meld     亮词区 4 行 14/11/8/5，由 x=222 往左生长（贴着右下角，§3）
 *   y 27..36   wall     牌墙，**两层的墩**，玩家侧 15 墩 x 66..156（别家 13 墩）
 *   y 54..90   discard  牌河 4×7，x 90..132，**第 0 行贴着桌心**往外长
 *   x/y 90..132         中央 42×42 空地，留给记分盘（D12，T2.2）
 * ```
 *
 * **两条不能破的几何约束**（需求文档 §3.2）：
 *
 * ① 牌河宽度必须等于中央空地边长：9×6 = 54，内侧边落在 (174−54)/2 = 60。
 *    差一点，转 90° 之后隔壁那家的牌河就会咬进来，四片在桌心撞成一团。
 * ② 任何区都不能贴着桌沿：贴着 x=174 的话，转 90° 之后它就贴着隔壁那家的 y=0，
 *    正好压在人家的散牌区上。
 *
 * **判断「哪儿是空的」必须连四家的旋转副本一起算。** 眼睛看着空的地方，很可能是
 * 下家的某个区转过来占着的——亮词区被挤到 x 18..60 就是这么定下来的。
 */

const Rotation = {
  FACE_UP: new Quaternion().setFromEuler(new Euler(0, 0, 0)),
  FACE_DOWN: new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0)),
  /**
   * **立着**：绕 x 转 90°，牌面法线从 +z 转到 −y，也就是**朝向这一家自己**。
   *
   * 别家的手牌就该这么摆——真牌桌上手牌是立在自己面前的，牌面对着本人、
   * 牌背对着桌心，别人只看得见背面。平着扣在桌上是「打出去的牌」或者「废牌」，
   * 不是手牌。立起来之后占地也从 6×9 变成 6×4（牌变成竖的了），
   * 但槽位的地皮仍按平放的 6×9 留——别家胡牌/荒牌后 `concealed` 要摊开成平放。
   */
  STANDING: new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)),
};

/** 一排/一列的步长就是牌的尺寸——格子紧挨着，不留缝 */
const DX = Size[ThingType.TILE].x; // 6
const DY = Size[ThingType.TILE].y; // 9
const DZ = Size[ThingType.TILE].z; // 4

type SlotOp = (slots: Array<Slot>) => Array<Slot>;

function start(slot: Slot): SlotOp {
  return () => [slot];
}

interface RepeatOptions {
  /** 是否把相邻两格用 shiftLeft / shiftRight 串起来（散牌区重排要用） */
  shift?: boolean;
}

/** 把每个格子沿 offset 复制 count 份，名字后缀 `.0` `.1` …，并记进 indexes */
function repeat(count: number, offset: Vector3, options: RepeatOptions = {}): SlotOp {
  return (slots) => {
    const result: Array<Slot> = [];
    for (const slot of slots) {
      const total = new Vector3(0, 0, 0);
      for (let i = 0; i < count; i++) {
        const copied = slot.copy(`.${i}`);
        copied.origin = copied.origin.clone().add(total);
        copied.indexes.push(i);
        result.push(copied);
        total.add(offset);

        if (options.shift && i < count - 1) {
          copied.linkDesc.shiftRight = `${slot.name}.${i + 1}`;
        }
        if (options.shift && i > 0) {
          copied.linkDesc.shiftLeft = `${slot.name}.${i - 1}`;
        }
      }
    }
    return result;
  };
}

function row(count: number, dx: number = DX, options: RepeatOptions = {}): SlotOp {
  return repeat(count, new Vector3(dx, 0, 0), options);
}

function column(count: number, dy: number = DY): SlotOp {
  return repeat(count, new Vector3(0, dy, 0));
}

/**
 * 一墩两层：同一处往上叠一张。
 *
 * 牌墙是**码起来的**，不是平铺的——真牌桌上每墩两张，摸牌时先取上面那张。
 * 我们的牌墙不可交互，所以不需要 Autotable 那套 `up`/`down` 链，位置对就够了。
 */
function stack(): SlotOp {
  return (slots) => {
    const out = repeat(WALL_LAYERS, new Vector3(0, 0, DZ))(slots);
    // **只给最下面那层画影子**：一墩两层在 xy 上完全重合，影子又一律拍在 z≈0 的桌面上，
    // 两块叠在一起会加倍变黑，还会自己跟自己 z-fighting
    for (const slot of out) {
      if (slot.indexes[slot.indexes.length - 1] > 0) slot.drawShadow = false;
    }
    return out;
  };
}

/**
 * 亮词区每行长度不同（第 i 行 `meldSlots(i)` 格），`row()` 那种「每行一样长」的
 * 复制表达不了，所以单独一个算子：先 column 出 4 行，再逐行按各自的长度铺开。
 */
function meldRows(): SlotOp {
  return (slots) => {
    const result: Array<Slot> = [];
    for (const slot of slots) {
      const rowIndex = slot.indexes[slot.indexes.length - 1];
      const n = meldSlots(rowIndex);
      for (let i = 0; i < n; i++) {
        const copied = slot.copy(`.${i}`);
        // **下标 0 是这一行最左边那格**，也就是单词的第一个字母。
        //
        // 一度写成从右往左编号（配 `direction = (-1, 1)`），四行的右边确实齐平了，
        // 但 `layMelds` 把第 i 个字母摆进第 i 格，于是整个词是倒着的——
        // 摆出来是 SRETUPMOC。行是右对齐的、字母是左起的，两件事要分开：
        // 右对齐靠**每行自己的起点**（右边界往左退 n 格），不靠反向编号。
        copied.origin = copied.origin.clone().add(new Vector3(-DX * (n - i), 0, 0));
        copied.indexes.push(i);
        result.push(copied);
      }
    }
    return result;
  };
}

/** 把整套格子复制到指定座位（默认四家），各自绕桌心旋转 */
function seats(which: number[] = [0, 1, 2, 3]): SlotOp {
  return (slots) => {
    const result: Array<Slot> = [];
    for (const seat of which) {
      for (const slot of slots) {
        const copied = slot.copy(`@${seat}`);
        copied.rotate(seat, WORLD_SIZE);
        result.push(copied);
      }
    }
    return result;
  };
}

/** 一排 n 格居中时，最左那格的 origin.x */
function centeredX(count: number): number {
  return (WORLD_SIZE - count * DX) / 2;
}

/** 中央空地的边长 = 牌河的宽度。见文件头约束 ① */
const CENTER_HOLE = DISCARD_COLS * DX; // 54
/** 牌河内侧边（也就是中央空地的近侧边）的 y */
const CENTER_HOLE_EDGE = (WORLD_SIZE - CENTER_HOLE) / 2; // 60

/**
 * 手牌与牌墙之间留出的空当。
 *
 * 牌墙紧贴着手牌是不对的——真牌桌上（Autotable 也一样：手牌 y=0、牌墙 y=20）
 * 两者之间隔着一段，那段空当是摸上来的牌、以及吃碰亮牌的操作余地。
 * 取 18（两个牌高），占桌宽 8.1%，与 Autotable 的 16/174 = 9.2% 同量级。
 */
const HAND_TO_WALL_GAP = 2 * DY; // 18
/** 牌墙那条带子的近侧边 */
const WALL_Y = DY + HAND_TO_WALL_GAP; // 27
/** 亮词区的近侧边：紧贴散牌区背后，从右手边往里长 */
const MELD_Y = DY; // 9
/**
 * 亮词区的右边界（每行从这里往 −x 长）——**齐着桌沿，尽量塞进右下角**。
 *
 * 需求文档 §3 说亮词区在右下角，那就贴到底：右边界 = WORLD_SIZE，桌面网格比槽位区
 * 大半个牌高（`Table3D.tsx` 的 `WORLD_SIZE + TILE.y`），所以牌仍然稳稳落在台面上。
 *
 * **再往角落挪不动了**：往 −y 走一格（首行 y=0）会撞上自己的散牌区——那一排横跨
 * x 69..177，而亮词第 0 行有 14 格 = 84 长，怎么摆都压得上去。真正的角落方块
 * （x 177..222 × y 0..9）只有 45 宽，塞不下任何一行。
 *
 * §3.2 约束 ② 原本要求离桌沿留一个牌高，理由是「转 90° 之后会压在下家的散牌区上」。
 * 那条在散牌区横贯整条边时成立；现在散牌区只占 x 69..177，转过去的亮词区落在
 * x 204..213 / y 216..222，正好从下家散牌区右端外侧让过去——按**格子**逐一验过，
 * 四家的旋转副本互不相犯（`setup-slots.test.ts` 那条「四家之间不重叠」守着）。
 */
const MELD_RIGHT = WORLD_SIZE; // 222，齐着桌沿

const START = {
  /**
   * 散牌区。**自己的平放正面朝上，别家立着**——所以两种朝向都要有，
   * `rotationIndex` 0=平放正面（自己的牌、以及别家胡牌后摊开的 `concealed`），
   * 1=立着（别家没亮出来的手牌，牌面朝他自己，我们只看得见背面）。
   *
   * 自己的牌为什么不立起来：散牌区是**排字母拼词的工作台**（D3、§4.1），
   * 要从上往下看着拖，立起来就没法排了。别家不需要排，立着才像手牌。
   *
   * **暗词不是独立的区**（需求文档 §3）：它就住在这一排里，只是被标记成一组，
   * 于是「组完暗词还能整体挪位置」直接复用这排的排列逻辑。
   *
   * **整排 18 格居中，4 格腾挪余量左右各 2 格。** 满手 14 张正好落在正中间那 14 格里
   * （下标 2..15），画面对称，往两边都挤得动。初始手牌摆在哪几格由 `rebuildLoose`
   * 决定（它会居中铺），这里只负责让格子居中。
   */
  loose: () =>
    new Slot({
      name: "loose",
      group: "loose",
      origin: new Vector3(centeredX(LOOSE_SLOTS), 0, 0),
      rotations: [Rotation.FACE_UP, Rotation.STANDING],
      canFlipMultiple: true,
      drawShadow: true,
      rotateHeld: true,
    }),

  /**
   * 亮词区。亮词是公开信息（连别家的 `melds` 都给真实字母，需求文档 §10 第 7 条），
   * 所以只有正面朝上一种朝向。永久冻结不可拖动，也就不需要 shift 链。
   *
   * 4 行、第 i 行 `meldSlots(i)` 格（14/11/8/5，§3.3）。**四行右对齐**——每行的
   * 起点是右边界往左退自己那么多格，于是长短不一的四行有一条齐整的右边。
   * 格子下标仍然**从左往右**数，第 0 格是单词的第一个字母（见 meldRows）。
   *
   * 这一整块最长一行 84 长，在原来 174 的桌面上站不下（摆上两层牌墙之后，
   * 桌上最大的合法空矩形只剩 28 格）。桌面放大到 222 之后它才回到身前这条带子上，
   * 而不是被挤到某个角落里。
   */
  meld: () =>
    new Slot({
      name: "meld",
      group: "meld",
      origin: new Vector3(MELD_RIGHT, MELD_Y, 0),
      rotations: [Rotation.FACE_UP],
      // 亮词区不接收拖放（亮词永久冻结），画影子纯粹是为了让人看清这块地在哪儿
      drawShadow: true,
    }),

  /**
   * 牌河。每家身前一片（§3.4，T0.4 已让服务端下发 `discardSeats`）。
   * 打出去的牌一律正面朝上。自己那片要能接收拖入（§4.7），所以画影子。
   *
   * **第 0 行贴着桌心，往外长**（`column(3, -DY)`，与 Autotable 同）——真牌桌就是
   * 这么打的：牌先落在离桌心最近的那行，摆满了才往自己身前退。反过来摆的话，
   * 牌河会从身前往桌心长，看着像在往中间挤。
   */
  discard: () =>
    new Slot({
      name: "discard",
      group: "discard",
      origin: new Vector3(centeredX(DISCARD_COLS), CENTER_HOLE_EDGE - DY, 0),
      rotations: [Rotation.FACE_UP],
      drawShadow: true,
    }),

  /**
   * 牌墙。**不可交互**（§9 Q6），只表达「还剩多少张」，所以只有背面一种朝向，
   * 不画影子、不接收拖放。
   *
   * 一条横在散牌区与牌河之间的带子，**每墩两层**。玩家那侧 15 墩、其余三家各 13 墩
   * （layout.ts：108 = 15×2 + 13×2×3，槽位零余量）。两种长度各自居中，
   * 所以要建两次、分别 `seats([0])` 与 `seats([1,2,3])`。
   */
  wall: (stacks: number) =>
    new Slot({
      name: "wall",
      group: "wall",
      origin: new Vector3(centeredX(stacks), WALL_Y, 0),
      rotations: [Rotation.FACE_DOWN],
      // 牌墙不可交互，画影子同样只为看清地皮；上层那张由 stack() 关掉，见那里
      drawShadow: true,
    }),
};

/** 建出全部槽位，并把 shiftLeft / shiftRight 的名字换成引用 */
export function makeSlots(): Map<string, Slot> {
  const groups: Array<Array<SlotOp>> = [
    [start(START.loose()), row(LOOSE_SLOTS, DX, { shift: true }), seats()],
    [start(START.meld()), column(MELD_ROWS), meldRows(), seats()],
    // 牌河：先按 −DY 往外铺 3 行（第 0 行贴桌心），每行再往 +x 铺 9 格
    [start(START.discard()), column(DISCARD_ROWS, -DY), row(DISCARD_COLS), seats()],
    // 牌墙：玩家侧 15 墩、别家各 13 墩，每墩两层。名字是 wall.<第几墩>.<第几层>
    [start(START.wall(WALL_STACKS_PLAYER)), row(WALL_STACKS_PLAYER), stack(), seats([0])],
    [start(START.wall(WALL_STACKS_OTHER)), row(WALL_STACKS_OTHER), stack(), seats([1, 2, 3])],
  ];

  const slots = new Map<string, Slot>();
  for (const group of groups) {
    let current: Array<Slot> = [];
    for (const op of group) {
      current = op(current);
    }
    for (const slot of current) {
      if (slots.has(slot.name)) {
        throw new Error(`槽位重名：${slot.name}`);
      }
      slots.set(slot.name, slot);
    }
  }

  Slot.setLinks(slots);
  return slots;
}
