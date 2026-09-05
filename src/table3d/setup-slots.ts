import { Euler, Quaternion, Vector2, Vector3 } from "three";
import {
  DISCARD_COLS,
  DISCARD_ROWS,
  LOOSE_SLOTS,
  MELD_ROWS,
  meldSlots,
  PLAYERS,
  WALL_COLS,
  WALL_ROWS,
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
 * 0 号座位从桌沿往桌心排开：
 *
 * ```
 *   y  0.. 9   loose    散牌区，一整排 18 格，x 居中 33..141
 *   y  9..45   meld     亮词区 4 行，由 x=165 往左生长（离桌沿留 9），x 81..165
 *   y 33..60   discard  牌河 3x9，x 居中 60..114
 *   y 45..81   wall     牌墙 4x4，x 141..165（右手边，被其余三个区挤出来的空盒子）
 *   x/y 60..114         中央 54x54 空地，留给记分盘（D12，T2.2）
 * ```
 *
 * **四家的牌河要拼成风车而不是撞在一起。** 关键是牌河那一块必须「x 方向居中，
 * 且内侧边正好切在中央空地的边上」：块宽 9×6 = 54，中央空地就得是 54×54，
 * 内侧边落在 87 − 27 = 60。这样转 90° 之后，隔壁那家的块只会与自己**贴边**，
 * 不会咬进来（Autotable 的牌河也是这么摆的，只是它的块是 36 宽）。
 *
 * 亮词区靠右、牌墙靠左，都与居中的牌河在 x 上错开；亮词区第 2、3 行本身也短，
 * 缩到 x ≥ 126，正好躲开牌河的 60..114。
 *
 * 槽位**数量**全部来自 `layout.ts`（可追溯到 `sim/rules.py`）；槽位**位置**是纯视觉
 * 选择，T1.3 / T2.1 摆上真牌之后还会再调——但上面那条「牌河宽度 = 中央空地边长」
 * 的约束不能破，破了四家牌河就会重叠。
 */

const Rotation = {
  FACE_UP: new Quaternion().setFromEuler(new Euler(0, 0, 0)),
  FACE_DOWN: new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0)),
};

/** 一排/一列的步长就是牌的尺寸——格子紧挨着，不留缝 */
const DX = Size[ThingType.TILE].x; // 6
const DY = Size[ThingType.TILE].y; // 9

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
 * 亮词区每行长度不同（第 i 行 `meldSlots(i)` 格），`row()` 那种「每行一样长」的
 * 复制表达不了，所以单独一个算子：先 column 出 4 行，再逐行按各自的长度铺开。
 */
function meldRows(): SlotOp {
  return (slots) => {
    const result: Array<Slot> = [];
    for (const slot of slots) {
      const rowIndex = slot.indexes[slot.indexes.length - 1];
      for (let i = 0; i < meldSlots(rowIndex); i++) {
        const copied = slot.copy(`.${i}`);
        // direction 是 (-1, 1)，牌往 -x 长；origin 也要跟着往 -x 走
        copied.origin = copied.origin.clone().add(new Vector3(-DX * i, 0, 0));
        copied.indexes.push(i);
        result.push(copied);
      }
    }
    return result;
  };
}

/** 把整套格子复制到四家，各自绕桌心旋转 */
function seats(): SlotOp {
  return (slots) => {
    const result: Array<Slot> = [];
    for (let seat = 0; seat < PLAYERS; seat++) {
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

/**
 * 中央空地的边长 = 牌河的宽度。见文件头注释：这两个数必须相等，
 * 四家的牌河才能拼成风车而不是在桌心撞成一团。
 */
const CENTER_HOLE = DISCARD_COLS * DX; // 54
/**
 * 亮词区离桌沿留出的距离。
 *
 * 亮词区贴着桌沿（x = 174）的话，转 90° 之后它就贴着隔壁那家的桌沿（y = 0），
 * 正好压在人家的散牌区上。留出一个牌高（9）就错开了。
 */
const MELD_EDGE_INSET = DY; // 9
/** 牌河内侧边（也就是中央空地的近侧边）的 y */
const CENTER_HOLE_EDGE = (WORLD_SIZE - CENTER_HOLE) / 2; // 60

const START = {
  /**
   * 散牌区。自己的正面朝上，别家渲染背面——所以两种朝向都要有，
   * `rotationIndex` 0=正面 1=背面（T2.1 按 envelope 决定用哪个）。
   *
   * **暗词不是独立的区**（需求文档 §3）：它就住在这一排里，只是被标记成一组，
   * 于是「组完暗词还能整体挪位置」直接复用这排的排列逻辑，不需要额外机制。
   */
  loose: () =>
    new Slot({
      name: "loose",
      group: "loose",
      origin: new Vector3(centeredX(LOOSE_SLOTS), 0, 0),
      rotations: [Rotation.FACE_UP, Rotation.FACE_DOWN],
      canFlipMultiple: true,
      drawShadow: true,
      rotateHeld: true,
    }),

  /**
   * 亮词区。亮词是公开信息（连别家的 `melds` 都给真实字母，需求文档 §10 第 7 条），
   * 所以只有正面朝上一种朝向。永久冻结不可拖动，也就不需要 shift 链。
   *
   * `direction = (-1, 1)` 让牌从右往左长——0 号座位的亮词区在右下角（§3）。
   */
  meld: () =>
    new Slot({
      name: "meld",
      group: "meld",
      origin: new Vector3(WORLD_SIZE - MELD_EDGE_INSET, 9, 0),
      direction: new Vector2(-1, 1),
      rotations: [Rotation.FACE_UP],
    }),

  /**
   * 牌河。每家身前一片（§3.4，T0.4 已让服务端下发 `discardSeats`）。
   * 打出去的牌一律正面朝上。自己那片要能接收拖入（§4.7），所以画影子。
   */
  discard: () =>
    new Slot({
      name: "discard",
      group: "discard",
      origin: new Vector3(centeredX(DISCARD_COLS), CENTER_HOLE_EDGE - DISCARD_ROWS * DY, 0),
      rotations: [Rotation.FACE_UP],
      drawShadow: true,
    }),

  /**
   * 牌墙。**不可交互**（§9 Q6），只用来表达「还剩多少张」，所以只有背面一种朝向，
   * 不画影子、不接收拖放。
   *
   * 位置是被挤出来的，不是选出来的：其余三个区连同它们的旋转副本排完之后，
   * 每家身边只剩 `x 141..165 × y 45..81` 这一个空盒子（右手边，亮词区外侧、
   * 下家散牌区内侧），4 列 × 4 行正好填满它。见 layout.ts 的 WALL_ROWS 注释。
   *
   * 需求文档 §3 把它写作「桌面中央四周」，实际落在四角偏内侧——中央四周已经被
   * 四片牌河占满了（牌河必须贴着中央空地才能拼成风车，见本文件头注释）。
   * 牌墙不参与任何操作，位置只是视觉问题，T2.1 摆上真牌后可再调。
   */
  wall: () =>
    new Slot({
      name: "wall",
      group: "wall",
      origin: new Vector3(141, 45, 0),
      rotations: [Rotation.FACE_DOWN],
    }),
};

/** 建出全部槽位，并把 shiftLeft / shiftRight 的名字换成引用 */
export function makeSlots(): Map<string, Slot> {
  const groups: Array<Array<SlotOp>> = [
    [start(START.loose()), row(LOOSE_SLOTS, DX, { shift: true }), seats()],
    [start(START.meld()), column(MELD_ROWS), meldRows(), seats()],
    [start(START.discard()), column(DISCARD_ROWS), row(DISCARD_COLS), seats()],
    [start(START.wall()), column(WALL_ROWS), row(WALL_COLS), seats()],
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
