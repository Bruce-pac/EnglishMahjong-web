/**
 * T2.1：把三层地基接到场景上。
 *
 * T1.4 建好了 A（散牌区对账）/ B（layout）/ C（实例分配）三层，T1.1–T1.3 建好了
 * 槽位与渲染层，但**没有任何代码把它们串起来**。这个文件就是那根线：
 *
 * ```
 * Envelope ──→ reconcileLoose ──→ layout ──→ assignThings ──→ ObjectView
 *              （A 层，有记忆）    （B 层）    （C 层，有记忆）
 * ```
 *
 * **顺序有硬性要求**（T1.4 方案 §4）：`assignThings` 必须跑在渲染提交**之前**，
 * 它读的是上一帧**已提交**的 `Thing.typeIndex`。顺序反了，轮 ① / ② 的比较全部
 * 退化成自比自，三轮匹配等于没做。所以本文件里 `commit()` 的步骤次序不能调换。
 *
 * 局面本身**只读**：服务端说什么就画什么，不含任何规则逻辑。唯一的本地交互状态是
 * T3.1 的悬停（`setHovered`）——它不改局面，只让那张牌换到 Custom 轨道去发光。
 * 组词 T4.x、动画 T5.x 还没接。
 */

import type { Envelope } from "../api";
import { TILE_COUNT } from "./layout";
import {
  rebuildLoose,
  reconcileLoose,
  type LooseSlots,
} from "./loose-reconcile";
import type { PickTarget } from "./mouse-ui";
import type { ObjectView, Render } from "./object-view";
import { assignThings } from "./thing-assign";
import { layout, type DisplayState, type Placement } from "./placement";
import * as persist from "./persist";
import { makeSlots } from "./setup-slots";
import type { Slot } from "./slot";
import { Thing } from "./thing";
import { ThingType } from "./types";

/** Thing 池的全部下标。`assignThings` 每帧都要，建一次就够 */
const ALL_THINGS = Array.from({ length: TILE_COUNT }, (_, i) => i);

/**
 * 桌面的全部状态：槽位、Thing 池、散牌区的那份记忆。
 *
 * 不碰 React、不碰相机、不发请求——调用方（`Table3D.tsx`）负责拿 envelope 进来。
 */
export class TableView {
  readonly slots: Map<string, Slot>;

  private readonly objectView: ObjectView;

  /** Thing 池。`null` = 这个实例还没上过桌 */
  private readonly things: Array<Thing | null> = new Array(TILE_COUNT).fill(null);

  /**
   * **已提交**的牌面编号，按 Thing 下标。`assignThings` 的 `typeIndexOf` 读它，
   * 所以它必须在 `commit()` 里最后才被覆盖。
   */
  private committed: number[] = new Array(TILE_COUNT).fill(0);

  /** 上一帧每个 Thing 停在哪个槽位（C 层的记忆，不持久化） */
  private lastSlotName = new Map<number, string>();

  /** A 层的记忆：哪张牌在散牌区的哪一格。**这份是要持久化的** */
  private loose: LooseSlots = [];
  private nextTileId = 1;

  private display: DisplayState = { lowercase: false };
  private matchId: string | null = null;
  /** 自己的座位号。只有这家散牌区的牌能拾取 */
  private mySeat = 0;

  /** 上一次提交给 ObjectView 的整批 Render。悬停变了就改个标志原样再交一次 */
  private renders: Render[] = [];
  /** 这一帧可拾取的牌：自己散牌区（含暗词）。交给 `MouseUi.updateObjects` */
  private pickTargets: PickTarget[] = [];
  /** 鼠标指着的 Thing 编号 */
  private hovered: number | null = null;

  constructor(objectView: ObjectView, slots: Map<string, Slot> = makeSlots()) {
    this.objectView = objectView;
    this.slots = slots;

    // 池子一次建满 108 个（T1.4 方案 §4.2）：全副牌在任何时刻都分布在散牌区、
    // 亮词区、牌河、牌墙里，同时可见的上限就是 108，不需要回收机制。
    // 一次建满还有个好处：此后每帧的形状都不变，`updateThingTypes()` 永远走得成
    // 快路径，不会退化成整批 dispose 重建。
    this.objectView.replaceThings(
      ALL_THINGS.map((index) => ({ type: ThingType.TILE, typeIndex: 0, index })),
    );
    for (const index of ALL_THINGS) this.objectView.hideThing(index);

    this.drawSlotShadows();
  }

  /**
   * 静态槽位影子：`drawShadow` 的格子画一块常驻淡影，告诉玩家「牌该放这」。
   * 槽位不会变，所以只在开局画一次。
   */
  private drawSlotShadows(): void {
    const places = [];
    for (const slot of this.slots.values()) {
      if (slot.drawShadow) places.push(slot.places[slot.shadowRotation]);
    }
    this.objectView.replaceShadows(places);
  }

  /** 手牌区大小写开关（§4.9）。纯显示，只作用于手牌区 */
  setLowercase(lowercase: boolean): void {
    this.display = { lowercase };
  }

  /**
   * 吃进一个 envelope，把局面画出来。
   *
   * @param consumedTileIds 前端自己发起的操作（打牌、组暗词、亮词）知道消耗掉的是
   *   哪几张牌，填进来消除重复字母的歧义（T1.4 方案 §2 规则 3）。T2.1 只读，
   *   永远是空的；T4.x 起才有内容。
   */
  apply(env: Envelope, consumedTileIds: readonly number[] = []): void {
    this.mySeat = env.state.me.seat;
    // ---- A 层：散牌区身份对账 ----
    //
    // 换了一局（或第一次进来）就先看有没有存档：`?match=<id>` 刷新回来时，
    // 玩家亲手排的顺序和白搭声明只存在于 localStorage 里，服务端不知道也推不出。
    if (this.matchId !== env.matchId) {
      this.matchId = env.matchId;
      const saved = persist.load(env.matchId);
      if (saved) {
        this.loose = saved.loose;
        this.nextTileId = saved.nextTileId;
        this.display = saved.display;
      } else {
        this.loose = [];
        this.nextTileId = 1;
      }
      // 换局 = 桌上的牌全部换了一批，上一局的实例身份没有任何参考价值
      this.lastSlotName.clear();
    }

    const r =
      this.loose.length === 0
        ? rebuildLoose(env.state.me, this.nextTileId)
        : reconcileLoose(env.state.me, this.loose, this.nextTileId, consumedTileIds);
    this.loose = r.slots;
    this.nextTileId = r.nextTileId;

    // 结算了就把存档清掉（方案 §6 的第一条时机），否则留着下一局误读
    if (env.matchFinished || env.result !== null) {
      persist.clear(env.matchId);
    } else {
      persist.save(env.matchId, {
        loose: this.loose,
        display: this.display,
        nextTileId: this.nextTileId,
      });
    }

    // ---- B 层：摊开局面 ----
    this.commit(layout(env.state, this.loose, this.display));
  }

  /**
   * C 层 + 渲染提交。**次序不能调换**，见文件头。
   *
   * 1. `assignThings` —— 读的是**上一帧**已提交的 typeIndex
   * 2. 提交牌面（快路径 `updateThingTypes`）
   * 3. 摆位置、交给 ObjectView
   */
  private commit(all: Placement[]): void {
    // Thing 池是**零余量的 108**（T1.4 方案 §4.2）：全副牌在任何时刻都分布在
    // 散牌区、亮词区、牌河、牌墙里，正好用满。真实牌局不可能超，但
    // `/api/dev` 后门能摆出超编的局面——`dev.py` 的 nextDraw 是
    // `engine.wall.append()`，只加不减，还会顶掉真人原来那手牌。
    //
    // 超了就把尾巴丢掉：`layout()` 最后摆的是牌墙，所以丢掉的正好是最不要紧的
    // 那几张。不加这道护栏的话，第 109 张会取到 undefined，崩在
    // 「Cannot set properties of undefined」上——根本看不出根因。
    let placements = all;
    if (all.length > TILE_COUNT) {
      console.warn(`牌张数超过一副牌：${all.length} > ${TILE_COUNT}，多出来的不画`);
      placements = all.slice(0, TILE_COUNT);
    }

    const assign = assignThings(
      placements,
      this.lastSlotName,
      (i) => this.committed[i],
      ALL_THINGS,
    );

    // ① 牌面。没被摆上桌的实例沿用旧值——它反正是隐藏的，但**不能乱改**：
    //    下一帧 assignThings 还要拿它当「这个实例上一帧长什么样」来配对
    const params = this.committed.map((typeIndex, index) => ({
      type: ThingType.TILE,
      typeIndex,
      index,
    }));
    placements.forEach((p, k) => {
      params[assign[k]].typeIndex = p.typeIndex;
    });
    this.objectView.updateThingTypes(params);
    this.committed = params.map((p) => p.typeIndex);

    // ② 位置。先整批腾空格子，否则整批换位时会互相判为「格子非空」
    for (const thing of this.things) thing?.prepareMove();

    const renders: Render[] = [];
    const pickTargets: PickTarget[] = [];
    const nextSlotName = new Map<number, string>();
    const placed = new Set<number>();

    placements.forEach((p, k) => {
      const slot = this.slots.get(p.slotName);
      // 槽位名对不上是**布局与 layout() 脱节**，不是运行时意外，当场炸掉别静默
      if (!slot) throw new Error(`没有这个槽位：${p.slotName}`);
      if (p.rotationIndex >= slot.rotations.length) {
        // slot.place() 是裸的 places[rotationIndex]，没有边界检查——越界不会报错，
        // 只会让坐标变成 NaN，牌从画面上消失。宁可在这儿说清楚
        throw new Error(
          `槽位 ${p.slotName} 只有 ${slot.rotations.length} 种朝向，` +
            `拿不到 rotationIndex=${p.rotationIndex}`,
        );
      }

      const index = assign[k];
      const thing = this.things[index] ?? new Thing(index, ThingType.TILE, p.typeIndex, slot);
      this.things[index] = thing;
      if (thing.slot !== slot || slot.thing !== thing) thing.moveTo(slot, p.rotationIndex);
      thing.rotationIndex = p.rotationIndex;
      thing.typeIndex = p.typeIndex;

      placed.add(index);
      nextSlotName.set(index, p.slotName);
      const place = thing.place();
      if (slot.group === "loose" && slot.seat === this.mySeat) pickTargets.push({ id: index, place });
      renders.push({
        thingIndex: index,
        place,
        // 平时没有选中、没有拖动，只有悬停的那一张走 Custom 轨，其余全部 setSimple、
        // 整桌合成 1 个 draw call。悬停标志在下面统一补
        selected: false,
        hovered: false,
        held: false,
        temporary: false,
        bottom: false,
      });
    });

    // 悬停的那张被这次 envelope 挪出了散牌区（打出去、亮出去）就不再算悬停
    if (!pickTargets.some((t) => t.id === this.hovered)) this.hovered = null;
    for (const r of renders) r.hovered = r.thingIndex === this.hovered;
    this.renders = renders;
    this.pickTargets = pickTargets;

    this.objectView.updateThings(renders);
    // 剩下的实例这一帧没牌可演，藏起来——不藏的话它们会顶着单位矩阵堆在原点
    for (const index of ALL_THINGS) if (!placed.has(index)) this.objectView.hideThing(index);

    this.lastSlotName = nextSlotName;
  }

  /** 这一帧可拾取的牌（自己散牌区，含暗词）。`MouseUi` 每帧把它写进代理体 */
  get pickables(): readonly PickTarget[] {
    return this.pickTargets;
  }

  /**
   * 设置悬停目标（T3.1）。`null` = 没指着任何牌。
   *
   * **悬停对象没变就什么都不做**——调用方每帧都会调，不能每帧推 108 张。
   * 变了才把上次那批 Render 改个标志重新提交：新指着的走 Custom 轨改 emissive，
   * 离开的那张由 `updateThings` 按 `custom` 标志切回 Simple 轨。
   * 不可拾取的编号一律当 null 处理。
   *
   * @returns 这次有没有重新提交
   */
  setHovered(index: number | null): boolean {
    const next = index !== null && this.pickTargets.some((t) => t.id === index) ? index : null;
    if (next === this.hovered) return false;
    this.hovered = next;
    for (const r of this.renders) r.hovered = r.thingIndex === next;
    this.objectView.updateThings(this.renders);
    return true;
  }

  get hoveredThing(): number | null {
    return this.hovered;
  }

  /** 测试用：读回这一帧每个 Thing 停在哪儿 */
  get slotNames(): ReadonlyMap<number, string> {
    return this.lastSlotName;
  }

  /** 测试用：读回散牌区那份记忆 */
  get looseSlots(): LooseSlots {
    return this.loose;
  }
}
