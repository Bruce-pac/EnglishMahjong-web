import { Euler, Quaternion, Vector3 } from "three";
import {
  DISCARD_COLS,
  DISCARD_ROWS,
  LOOSE_CENTERED_ON,
  LOOSE_SLOTS,
  MELD_COLS,
  MELD_ROWS,
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
 * 0 号座位从桌沿往桌心排开（次序照真牌桌与 Autotable：手牌 → 牌墙 → 牌河 → 桌心）：
 *
 * ```
 *   y  0.. 9   loose    散牌区，一整排 18 格，x 45..153（按满手 14 张居中，余量在右）
 *   y  9..18   wall     牌墙，**两层的墩**，玩家侧 15 墩 x 42..132（别家 13 墩）
 *   y 18..54   meld     亮词区 7 列 × 4 行，x 18..60（形状是被牌墙挤出来的，见下）
 *   y 33..60   discard  牌河 3×9，x 60..114，**第 0 行贴着桌心**往外长
 *   x/y 60..114         中央 54×54 空地，留给记分盘（D12，T2.2）
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
  return repeat(WALL_LAYERS, new Vector3(0, 0, DZ));
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

/** 牌墙那条带子的近侧边：紧贴散牌区背后 */
const WALL_Y = DY; // 9
/** 亮词区的近侧边：紧贴牌墙背后 */
const MELD_Y = WALL_Y + DY; // 18
/** 亮词区的左边界。再往左是下家亮词区转过来的地盘 */
const MELD_X = 3 * DX; // 18

const START = {
  /**
   * 散牌区。自己的正面朝上，别家渲染背面——所以两种朝向都要有，
   * `rotationIndex` 0=正面 1=背面。
   *
   * **暗词不是独立的区**（需求文档 §3）：它就住在这一排里，只是被标记成一组，
   * 于是「组完暗词还能整体挪位置」直接复用这排的排列逻辑。
   *
   * 按**满手 14 张**居中，余下的 4 格腾挪余量挂在右边：居中的该是牌，不是空格子。
   */
  loose: () =>
    new Slot({
      name: "loose",
      group: "loose",
      origin: new Vector3(centeredX(LOOSE_CENTERED_ON), 0, 0),
      rotations: [Rotation.FACE_UP, Rotation.FACE_DOWN],
      canFlipMultiple: true,
      drawShadow: true,
      rotateHeld: true,
    }),

  /**
   * 亮词区。亮词是公开信息（连别家的 `melds` 都给真实字母，需求文档 §10 第 7 条），
   * 所以只有正面朝上一种朝向。永久冻结不可拖动，也就不需要 shift 链。
   *
   * **位置和形状都是被牌墙挤出来的。** 摆上两层的牌墙之后，把四家旋转副本一起算，
   * 桌上最大的合法空矩形就只剩这块 7 列 × 4 行（x 18..60 × y 18..54）。
   * 需求文档 §3 说亮词区在「右下角」、§3.3 说 4 行 14/11/8/5——那是牌墙还没摆上桌
   * 时推的，一行 14 格 = 84 长，站不下。见 layout.ts 的 MELD_COLS 注释。
   */
  meld: () =>
    new Slot({
      name: "meld",
      group: "meld",
      origin: new Vector3(MELD_X, MELD_Y, 0),
      rotations: [Rotation.FACE_UP],
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
    }),
};

/** 建出全部槽位，并把 shiftLeft / shiftRight 的名字换成引用 */
export function makeSlots(): Map<string, Slot> {
  const groups: Array<Array<SlotOp>> = [
    [start(START.loose()), row(LOOSE_SLOTS, DX, { shift: true }), seats()],
    [start(START.meld()), column(MELD_ROWS), row(MELD_COLS), seats()],
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
