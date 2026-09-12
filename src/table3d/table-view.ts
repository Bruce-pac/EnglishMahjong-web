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
 * 局面本身**只读**：服务端说什么就画什么，不含任何规则逻辑。本地交互只有两样：
 * - T3.1 悬停（`setHovered`）：不改局面，只让那张牌换到 Custom 轨道去发光
 * - T3.2 拖放重排（`dragStart / dragMove / dragEnd`）：纯本地、不上报服务端（D3），
 *   松手后写回 A 层的 `LooseSlots` 并存档，再走一遍正常的 layout → 分配 → 提交
 * - T3.3 框选（`setSelected`）：选中按 tileId 记，走 Custom 轨道交给 OutlinePass 描金边
 * - T3.4 打牌：拖到自己牌河时 `dragEnd()` 返回 `DiscardIntent`，右键用 `discardIntentOf()`。
 *   **这里不发请求**，只告诉调用方要打哪张；牌落进牌河哪一格由服务端的 envelope 决定
 * 组词 T4.x、动画 T5.x 还没接。
 */

import { Vector3 } from "three";
import type { Envelope } from "../api";
import { TILE_COUNT } from "./layout";
import {
  compactGroup,
  declareWild,
  groupKeyOf,
  insertLoose,
  markGroup,
  moveGroupLoose,
  splitsGroup,
  rebuildLoose,
  reconcileLoose,
  type LooseEntry,
  type LooseSlots,
} from "./loose-reconcile";
import type { PickTarget } from "./mouse-ui";
import type { DiscardIntent } from "./discard";
import { findSlot, Movement } from "./movement";
import type { ObjectView, Render } from "./object-view";
import { assignThings } from "./thing-assign";
import { layout, type DisplayState, type Placement } from "./placement";
import * as persist from "./persist";
import { makeSlots } from "./setup-slots";
import type { Slot } from "./slot";
import { Thing } from "./thing";
import { Size, ThingType } from "./types";
import { rectangleOverlap } from "./utils";
import { WILD_CANDIDATES } from "./atlas";

/** 被挤开 / 落下的牌滑过去用多久（Autotable 的 SHIFT_TIME）。完整动画层是 T5.1 */
export const SHIFT_TIME = 100;

/** 一段滑动：从哪到哪、什么时候开始 */
interface Slide {
  from: Vector3;
  to: Vector3;
  start: number;
}

/**
 * 这个 envelope 属于这一场的第几局（从 0 数）。
 *
 * **不能直接拿 `state.gamesPlayed`**：服务端在一局**结算时**就把它加 1，而不是下一局开出来时。
 * 第 1 局进行中是 0、结算时变 1（带 result）、第 2 局开出来仍是 1（result 为空）。
 * 直接比 gamesPlayed 的话，结算那一刻就会被当成换局，散牌区被清空重铺、白搭声明丢失。
 * 所以带 result 的 envelope 还算上一局：减 1
 */
export function gameIndexOf(env: Envelope): number {
  return env.result ? env.state.gamesPlayed - 1 : env.state.gamesPlayed;
}

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
  /** 这是这一场的第几局（从 0 数，见 `gameIndexOf`）。同一 matchId 下它变了 = 换局（T6.3） */
  private gameIndex: number | null = null;
  /** 自己的座位号。只有这家散牌区的牌能拾取 */
  private mySeat = 0;

  /** 上一次提交给 ObjectView 的整批 Render。悬停变了就改个标志原样再交一次 */
  private renders: Render[] = [];
  /** 这一帧可拾取的牌：自己散牌区（含暗词）。交给 `MouseUi.updateObjects` */
  private pickTargets: PickTarget[] = [];
  /** 鼠标指着的 Thing 编号 */
  private hovered: number | null = null;
  /**
   * 框选选中的牌，**按 tileId 记，不按 Thing 编号记**：对账时同字母的两张牌可能
   * 对调实例，tileId 才是牌的身份。牌离开散牌区就从这里去掉（见 commit）
   */
  private selectedTiles = new Set<number>();
  /**
   * 单击选中的暗词（T4.3），按 `groupKey` 记——`groupId` 每帧重算，key 才跨帧稳定。
   * 暗词被拆开后对账会清掉 key，这里自然就找不到了（[拆开] 按钮随之消失）
   */
  private focusedKey: string | null = null;
  /** 吃牌时会用掉的牌（T6.1），按 tileId 记。只是高亮，不是选中 */
  private chiTiles = new Set<number>();

  /** 最近一次的 envelope。拖放落下后要拿它的 state 重新 layout、判断要不要存档 */
  private lastEnv: Envelope | null = null;

  // ---- T3.2 拖放 ----
  /** 手里拿着的牌（按下的那张，整组拖动时它是锚点）。null = 没在拖 */
  private held: Thing | null = null;
  /**
   * 一起拿起来的牌（T4.3）：按下的是暗词里的牌就是整个暗词，否则只有 held 自己。
   * 按槽位从左到右排
   */
  private heldGroup: Thing[] = [];
  /** 按下时鼠标在拖动平面上的位置；之后的位移都相对它算 */
  private heldMouse: Vector3 | null = null;
  private mouse: Vector3 | null = null;
  /** 这一帧的「谁要去哪」。null = 当前落点不合法（或没沾到任何格子） */
  private movement: Movement | null = null;
  /** 正在滑动的牌，按 Thing 编号 */
  private slides = new Map<number, Slide>();
  /** 每张牌上一帧**画在哪**。起一段新滑动时从这里出发，不会跳 */
  private drawn = new Map<number, Vector3>();
  /** 拿着的牌现在压在自己牌河上方（T3.4） */
  private overRiver = false;
  /** 现在能不能打牌。由调用方按 `pending` 设（`canDiscard`），这里不判规则 */
  private discardAllowed = false;

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
    // 拖到一半局面变了（将来轮到 AI 出牌时会这样）：先把手上的牌放回原位
    this.cancelDrag();
    this.lastEnv = env;
    this.mySeat = env.state.me.seat;
    // ---- A 层：散牌区身份对账 ----
    //
    // 换了一局（或第一次进来）就先看有没有存档：`?match=<id>` 刷新回来时，
    // 玩家亲手排的顺序和白搭声明只存在于 localStorage 里，服务端不知道也推不出。
    if (this.matchId !== env.matchId) {
      this.matchId = env.matchId;
      const saved = persist.load(env.matchId);
      if (saved) {
        this.nextTileId = saved.nextTileId;
        this.display = saved.display;
        // 存档是同一场上一局留下的（别的标签页开了下一局、然后刷新）：散牌区身份不能带过来，
        // 但 nextTileId 照用——tileId 跨局也永不回收
        const sameGame = saved.gameIndex === undefined || saved.gameIndex === gameIndexOf(env);
        this.loose = sameGame ? saved.loose : [];
      } else {
        this.loose = [];
        this.nextTileId = 1;
      }
      // 换局 = 桌上的牌全部换了一批，上一局的实例身份没有任何参考价值
      this.lastSlotName.clear();
      this.gameIndex = gameIndexOf(env);
    } else if (gameIndexOf(env) !== this.gameIndex) {
      // 同一场换了一局，matchId 不变：兜底判定换局（[下一局] 之外，别的标签页开了下一局也会走到这里）
      this.resetGame();
      this.gameIndex = gameIndexOf(env);
    }

    const r =
      this.loose.length === 0
        ? rebuildLoose(env.state.me, this.nextTileId)
        : reconcileLoose(env.state.me, this.loose, this.nextTileId, consumedTileIds);
    this.loose = r.slots;
    this.nextTileId = r.nextTileId;
    this.saveAndCommit();
  }

  /** 存档 + B 层摊开 + 提交。envelope 进来和本地拖放落下都走这里 */
  private saveAndCommit(): void {
    const env = this.lastEnv!;
    // 结算了就把存档清掉（方案 §6 的第一条时机），否则留着下一局误读
    if (env.matchFinished || env.result !== null) {
      persist.clear(env.matchId);
    } else {
      persist.save(env.matchId, {
        loose: this.loose,
        display: this.display,
        nextTileId: this.nextTileId,
        gameIndex: this.gameIndex ?? undefined,
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
    // 选中的牌同理：已经不在散牌区的 tileId 去掉，还在的保持选中
    const live = new Set(this.loose.flatMap((e) => (e ? [e.tileId] : [])));
    for (const id of this.selectedTiles) if (!live.has(id)) this.selectedTiles.delete(id);
    this.renders = renders;
    this.pickTargets = pickTargets;
    this.refreshFlags();

    this.objectView.updateThings(renders);
    // 剩下的实例这一帧没牌可演，藏起来——不藏的话它们会顶着单位矩阵堆在原点
    for (const index of ALL_THINGS) if (!placed.has(index)) this.objectView.hideThing(index);

    this.lastSlotName = nextSlotName;
  }

  // ================= T3.2 拖放 =================

  /** 自己散牌区那一排格子。落点只在这里找，落到别处就取消（牌河是 T3.4） */
  private looseRow(): Slot[] {
    return [...this.slots.values()].filter((s) => s.group === "loose" && s.seat === this.mySeat);
  }

  /** 自己散牌区上的牌（可能被挤的就是它们） */
  private looseThings(): Thing[] {
    return this.pickTargets.map((t) => this.things[t.id]!);
  }

  /** 自己的牌河。拖到这片区域 = 打牌；落在哪一格由服务端决定 */
  private riverSlots(): Slot[] {
    return [...this.slots.values()].filter((s) => s.group === "discard" && s.seat === this.mySeat);
  }

  /** 现在能不能打牌（T3.4）。不能时拖到牌河就是非法落点，牌回原位 */
  setDiscardAllowed(allowed: boolean): void {
    this.discardAllowed = allowed;
  }

  /**
   * 这张牌（Thing 编号）是不是暗词里的牌。
   *
   * 暗词里的牌**不单独参与任何操作**（打牌、框选、组暗词、亮词），要用得先拆开。
   * 原因在服务端只认字母：暗词 LOST 右边还有一张散的 T 时，提交「打 T」，服务端打掉的是
   * 散的那张，前端却把暗词里那张当成打出的牌移除，下一次对账 LOST 就配到了散的 T 上
   */
  inGroup(thingIndex: number): boolean {
    return this.entryOf(thingIndex)?.groupId !== undefined;
  }

  // ================= T4.4 白搭赋值 =================

  /**
   * 双击赋值要弹选择器的那张白搭：tileId、种类、选择器锚点（牌顶面上方，`mainGroup` 局部坐标，
   * 调用方每帧用 `mouseUi.project` 投到屏幕）。
   * 不是白搭、不在散牌区、或是暗词里的白搭（它的字母由暗词的 word 决定）都返回 null
   */
  wildPickerAt(thingIndex: number): { tileId: number; kind: "1" | "2"; anchor: Vector3 } | null {
    const e = this.entryOf(thingIndex);
    if (!e || (e.tile !== "1" && e.tile !== "2") || e.groupId !== undefined) return null;
    return { tileId: e.tileId, kind: e.tile, anchor: this.anchorAbove(thingIndex) };
  }

  /** 按 tileId 找回选择器的锚点。那张牌离开了散牌区（打出、亮出）或进了暗词就返回 null，选择器随之关闭 */
  wildAnchorOf(tileId: number): Vector3 | null {
    const thing = this.looseThings().find((t) => this.entryOf(t.index)?.tileId === tileId);
    if (!thing || this.inGroup(thing.index)) return null;
    return this.anchorAbove(thing.index);
  }

  private anchorAbove(thingIndex: number): Vector3 {
    const place = this.things[thingIndex]!.place();
    const anchor = place.position.clone();
    anchor.z += place.size.z / 2;
    anchor.y += place.size.y / 2;
    return anchor;
  }

  /**
   * 给白搭定字母（T4.4）。声明挂在 tileId 上、会存档，之后随时可以改。
   * 只换牌面，走 `updateThingTypes` 的快路径，不整组重建。
   * 暗词里的白搭、普通字母牌、不在散牌区的牌、字母不在本类候选里，一律返回 false、什么都不改
   */
  declareWildTile(tileId: number, letter: string): boolean {
    const e = this.loose.find((x) => x?.tileId === tileId);
    if (!e || (e.tile !== "1" && e.tile !== "2") || e.groupId !== undefined) return false;
    const lc = letter.toLowerCase();
    if (!WILD_CANDIDATES[e.tile].includes(lc)) return false;
    this.loose = declareWild(this.loose, tileId, lc);
    this.saveAndCommit();
    return true;
  }

  /** 双击那张牌定字母：同 `declareWildTile`，入参是 Thing 编号 */
  declareWildAt(thingIndex: number, letter: string): boolean {
    const e = this.entryOf(thingIndex);
    return e ? this.declareWildTile(e.tileId, letter) : false;
  }

  /** 右键打牌：这张牌（Thing 编号）的打牌意图。不在自己散牌区、或是暗词里的牌，返回 null */
  discardIntentOf(thingIndex: number): DiscardIntent | null {
    if (this.inGroup(thingIndex)) return null;
    const tileId = this.tileIdOf(thingIndex);
    if (tileId === null) return null;
    const entry = this.loose.find((e) => e?.tileId === tileId)!;
    return { tileId, tile: entry.tile };
  }

  get dragging(): boolean {
    return this.held !== null;
  }

  /**
   * 拖动平面的高度：拿着的牌（或正指着的牌）的**顶面**。鼠标射线在这个高度的平面上
   * 取点，按下那一刻指着牌面哪儿，拖动全程手指就还捏在牌面那一点上。
   */
  get dragZ(): number | null {
    const thing = this.held ?? (this.hovered !== null ? this.things[this.hovered] : null);
    if (!thing) return null;
    const place = thing.place();
    return place.position.z + place.size.z / 2;
  }

  /** 在悬停的牌上按下 → 拿起。没指着牌返回 false */
  dragStart(mouse3: Vector3): boolean {
    if (this.held || this.hovered === null) return false;
    // 拖一张牌时先清空选中（整组拖动是 T4.3）
    this.clearSelection();
    this.held = this.things[this.hovered]!;
    // 按下的是暗词里的牌 → 整组一起拿起，成员之间的相对格距不变
    const gid = this.entryOf(this.held.index)?.groupId;
    this.heldGroup =
      gid === undefined
        ? [this.held]
        : this.looseThings()
            .filter((t) => this.entryOf(t.index)?.groupId === gid)
            .sort((a, b) => a.slot.indexes[0] - b.slot.indexes[0]);
    this.setHovered(null);
    this.heldMouse = mouse3.clone();
    this.mouse = mouse3.clone();
    this.movement = null;
    this.drag();
    return true;
  }

  /** 拖动中鼠标动了。null = 鼠标出了画布，停在最后的位置 */
  dragMove(mouse3: Vector3 | null): void {
    if (!this.held || mouse3 === null) return;
    if (this.mouse && this.mouse.equals(mouse3)) return;
    this.mouse = mouse3.clone();
    this.drag();
  }

  /**
   * 每次鼠标一动就重建一个 Movement（Autotable 的 `world.ts:drag`）。
   * 只改 Movement 和预览，**不碰 Thing.slot、不碰 LooseSlots**。
   */
  private drag(): void {
    const held = this.held!;
    const place = held.place();
    const x = place.position.x + this.mouse!.x - this.heldMouse!.x;
    const y = place.position.y + this.mouse!.y - this.heldMouse!.y;

    // 压在自己牌河上方（照 findSlot 的「重叠超过 1」算沾上）：这一下是打牌，不找格子
    const tile = Size[ThingType.TILE];
    this.overRiver = this.riverSlots().some((s) => {
      const p = s.place(0);
      return rectangleOverlap(x, y, tile.x, tile.y, p.position.x, p.position.y, p.size.x, p.size.y) > 1;
    });

    // 整组拖动：锚点（按下的那张）找落点，其余成员按原来的相对格距跟着走，
    // 一次 move 多张（Autotable world.ts:320-350）。任何一张越界 → 非法落点
    let movement: Movement | null = new Movement();
    const target = this.overRiver ? null : findSlot(this.looseRow(), x, y, place.size.x, place.size.y);
    if (target === null) {
      movement = null;
    } else {
      const row = this.looseRow().sort((a, b) => a.indexes[0] - b.indexes[0]);
      const delta = target.indexes[0] - held.slot.indexes[0];
      for (const member of this.heldGroup) {
        const slot = row[member.slot.indexes[0] + delta];
        if (!slot) {
          movement = null;
          break;
        }
        movement.move(member, slot);
      }
      if (movement && (!movement.findShift(this.looseThings()) || !movement.valid())) movement = null;
      // 暗词除非拆开，不能被别的牌分开：按落下后的结果判，会把别的牌塞进某个暗词中间就是非法落点
      if (movement && target !== held.slot) {
        const result = this.dropResult(target);
        if (!result || splitsGroup(this.loose, result)) movement = null;
      }
    }
    this.movement = movement;

    // 被挤开的牌滑到预览位置；不再被挤的滑回去
    const now = performance.now();
    for (const thing of this.looseThings()) {
      if (this.heldGroup.includes(thing)) continue;
      const to = (movement?.shifts().get(thing) ?? thing.slot).place(thing.rotationIndex).position;
      const cur = this.slides.get(thing.index);
      if (cur ? !cur.to.equals(to) : !this.drawnAt(thing).equals(to)) this.slideTo(thing, to, now);
    }

    // 落点影子：合法才画，所见即所得
    this.objectView.updateDropShadows(movement ? [...movement.slots()].map((s) => s.place(0)) : []);
  }

  /**
   * 松手。落点合法就写回 LooseSlots；否则（含没挪动）牌回原位。
   *
   * 落在自己牌河上且现在能打牌：牌先滑回原位，返回打牌意图交给调用方提交。
   * 服务端的 envelope 回来后，带着这张的 tileId 对账，它才从散牌区消失、出现在牌河里。
   */
  dragEnd(): DiscardIntent | null {
    const held = this.held;
    if (!held) return null;
    if (this.overRiver) {
      // 整组拖到牌河不算打牌（一次只能打一张），整组滑回
      const single = this.heldGroup.length === 1;
      const intent = single && this.discardAllowed ? this.discardIntentOf(held.index) : null;
      this.cancelDrag();
      return intent;
    }
    const target = this.movement?.get(held) ?? null;
    let next = target && target !== held.slot ? this.dropResult(target) : null;
    if (next && splitsGroup(this.loose, next)) next = null;

    if (!next) {
      this.cancelDrag();
      return null;
    }

    // 落下之前记下每个 tileId 画在哪——提交之后实例可能换人（assignThings 按牌面配对，
    // 同字母的两张可能对调实例），所以滑动要按 tileId 接，不能按 Thing 接
    const fromPos = new Map<number, Vector3>();
    this.loose.forEach((e, i) => {
      const thing = this.slots.get(`loose.${i}@${this.mySeat}`)?.thing;
      if (e && thing) fromPos.set(e.tileId, this.drawnAt(thing).clone());
    });

    this.endDrag();
    this.loose = next;
    this.saveAndCommit();

    const now = performance.now();
    this.slides.clear();
    this.loose.forEach((e, i) => {
      const thing = this.slots.get(`loose.${i}@${this.mySeat}`)?.thing;
      const start = e && fromPos.get(e.tileId);
      if (!thing || !start) return;
      this.drawn.set(thing.index, start);
      this.slideTo(thing, thing.place().position, now);
    });
    return null;
  }

  /** 放弃这次拖动：世界状态本来就没动过，只要把画面滑回原位 */
  cancelDrag(): void {
    if (!this.held) return;
    const now = performance.now();
    const things = this.looseThings();
    this.endDrag();
    for (const thing of things) this.slideTo(thing, thing.place().position, now);
  }

  /**
   * 拿着的牌（或整组）落到 `target` 之后的 LooseSlots。与 Movement 的预览逐格一致（有随机测试），
   * 预览时拿它判「会不会分开暗词」，松手时拿它写回
   */
  private dropResult(target: Slot): LooseSlots | null {
    const held = this.held!;
    const from = held.slot.indexes[0];
    const to = target.indexes[0];
    return this.heldGroup.length > 1
      ? moveGroupLoose(
          this.loose,
          this.heldGroup.map((t) => this.entryOf(t.index)!.tileId),
          from,
          to,
        )
      : insertLoose(this.loose, from, to);
  }

  private endDrag(): void {
    this.held = null;
    this.heldGroup = [];
    this.heldMouse = null;
    this.mouse = null;
    this.movement = null;
    this.overRiver = false;
    this.objectView.updateDropShadows([]);
  }

  private drawnAt(thing: Thing): Vector3 {
    return this.drawn.get(thing.index) ?? thing.place().position;
  }

  private slideTo(thing: Thing, to: Vector3, now: number): void {
    this.slides.set(thing.index, { from: this.drawnAt(thing).clone(), to: to.clone(), start: now });
  }

  /**
   * 每帧调一次：画拿着的牌和正在滑的牌。**只有拖动中或有滑动时才提交**，
   * 而且只提交自己散牌区那 ≤18 张——其余的实例矩阵原封不动。
   */
  update(now: number): void {
    if (!this.held && this.slides.size === 0) return;

    const renders: Render[] = [];
    for (const thing of this.looseThings()) {
      const place = thing.place();
      let position = place.position;
      const held = this.heldGroup.includes(thing);

      if (held) {
        position = place.position.clone();
        position.x += this.mouse!.x - this.heldMouse!.x;
        position.y += this.mouse!.y - this.heldMouse!.y;
      } else {
        const slide = this.slides.get(thing.index);
        if (slide) {
          const t = Math.min(1, (now - slide.start) / SHIFT_TIME);
          position = slide.from.clone().lerp(slide.to, t);
          // 预览中的让位滑到了也不能删：它停在预览格上，不是 thing.place()
          if (t >= 1 && !this.held) this.slides.delete(thing.index);
        }
      }
      this.drawn.set(thing.index, position.clone());

      renders.push({
        thingIndex: thing.index,
        place: { ...place, position },
        selected: false,
        hovered: false,
        held,
        // 压在牌河上且能打：不算非法落点，不画半透明
        temporary:
          held &&
          this.movement === null &&
          !(this.overRiver && this.discardAllowed && this.heldGroup.length === 1),
        bottom: false,
        // 滑动过程中暗词框也得在，不然一拖就闪一下
        grouped: this.entryOf(thing.index)?.groupId !== undefined,
        highlighted: this.chiTiles.has(this.entryOf(thing.index)?.tileId ?? -1),
      });
    }
    if (!this.held && this.slides.size === 0) this.drawn.clear();
    this.objectView.updateThings(renders);
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
    // 拖动中不拾取（Autotable 的 toSelect 在拿着牌时返回空）
    if (this.held && index !== null) return false;
    const next = index !== null && this.pickTargets.some((t) => t.id === index) ? index : null;
    if (next === this.hovered) return false;
    this.hovered = next;
    this.refreshFlags();
    this.objectView.updateThings(this.renders);
    return true;
  }

  /** 把悬停 / 选中两个标志按当前状态写进上一批 Render */
  private refreshFlags(): void {
    for (const r of this.renders) {
      r.hovered = r.thingIndex === this.hovered;
      const tileId = this.tileIdOf(r.thingIndex);
      r.selected = tileId !== null && this.selectedTiles.has(tileId);
      r.grouped = this.entryOf(r.thingIndex)?.groupId !== undefined;
      r.highlighted = tileId !== null && this.chiTiles.has(tileId);
    }
  }

  /**
   * 吃牌时高亮会用掉的那几张（T6.1）。集合没变就不重新提交。
   * 离开散牌区的 tileId 自然就高亮不到了（refreshFlags 按当前 LooseSlots 查）
   */
  setChiHighlight(tileIds: readonly number[]): void {
    const next = new Set(tileIds);
    if (next.size === this.chiTiles.size && [...next].every((id) => this.chiTiles.has(id))) return;
    this.chiTiles = next;
    this.refreshFlags();
    this.objectView.updateThings(this.renders);
  }

  /** 这张牌（Thing 编号）在 LooseSlots 里的 entry。不在自己散牌区返回 null */
  private entryOf(thingIndex: number): LooseEntry | null {
    const slot = this.things[thingIndex]?.slot;
    if (!slot || slot.group !== "loose" || slot.seat !== this.mySeat) return null;
    return this.loose[slot.indexes[0]] ?? null;
  }

  /** 这张牌（Thing 编号）的 tileId。不在自己散牌区返回 null */
  private tileIdOf(thingIndex: number): number | null {
    const slot = this.things[thingIndex]?.slot;
    if (!slot || slot.group !== "loose" || slot.seat !== this.mySeat) return null;
    return this.loose[slot.indexes[0]]?.tileId ?? null;
  }

  /**
   * 设置框选结果（T3.3）。`thingIds` 是 `MouseUi.select` 给的 Thing 编号，
   * 这里换成 tileId 记下。不可拾取的编号忽略。集合没变就不重新提交。
   *
   * @returns 这次有没有重新提交
   */
  setSelected(thingIds: readonly number[]): boolean {
    const next = new Set<number>();
    for (const i of thingIds) {
      if (!this.pickTargets.some((t) => t.id === i)) continue;
      // 暗词里的牌不单独参与操作：框选框进来也不算选中（见 inGroup）
      if (this.inGroup(i)) continue;
      const tileId = this.tileIdOf(i);
      if (tileId !== null) next.add(tileId);
    }
    if (next.size === this.selectedTiles.size && [...next].every((id) => this.selectedTiles.has(id))) {
      return false;
    }
    this.selectedTiles = next;
    this.refreshFlags();
    this.objectView.updateThings(this.renders);
    return true;
  }

  /**
   * 组暗词成功后、对账之前调用（T4.2）：把暗词的 key 写到选中的那几张牌上，
   * 让随后的配对认准它们，而不是散牌区里最左边的同字母牌
   */
  markGroup(tileIds: readonly number[], tiles: string, word: string): void {
    this.loose = markGroup(this.loose, tileIds, groupKeyOf(tiles, word));
  }

  /**
   * 组暗词成功后收拢（T4.3）：成员向左连成一块。和 `markGroup` 一样在对账之前调用，
   * 于是只有一次提交。成员之间夹着别的牌时 `compactGroup` 返回 null，就不收拢
   */
  compactGroup(tileIds: readonly number[]): void {
    this.loose = compactGroup(this.loose, tileIds) ?? this.loose;
  }

  clearSelection(): void {
    this.focusedKey = null;
    this.setSelected([]);
  }

  /**
   * 单击暗词里的一张（T4.3）：聚焦这个暗词，调用方据此在组旁显示 [拆开]。
   *
   * **不选中成员**：选中会触发单词校验，左下角就会冒出校验条和 [组暗词] [亮词] [取消]——
   * 单击暗词只该出 [拆开]。已有的选中顺手清掉，免得残留的校验条和 [拆开] 同时出现。
   * 暗词本身的框一直在，不需要再描金边。点的不是暗词里的牌返回 false，什么都不改
   */
  focusGroupAt(thingIndex: number): boolean {
    const key = this.entryOf(thingIndex)?.groupKey;
    if (!key || this.entryOf(thingIndex)?.groupId === undefined) return false;
    this.setSelected([]);
    this.focusedKey = key;
    return true;
  }

  clearFocusedGroup(): void {
    this.focusedKey = null;
  }

  /**
   * 聚焦中的暗词：拆开要提交的牌面（按槽位从左到右，服务端会自己排序），
   * 以及 [拆开] 按钮的锚点——最右边那张牌顶面的上方，`mainGroup` 局部坐标，
   * 调用方每帧用 `mouseUi.project` 投到屏幕，镜头动了按钮跟着走。没有聚焦的暗词返回 null
   */
  focusedGroupInfo(): { tiles: string; anchor: Vector3 } | null {
    if (this.focusedKey === null) return null;
    const members = this.looseThings()
      .filter((t) => {
        const e = this.entryOf(t.index);
        return e?.groupKey === this.focusedKey && e.groupId !== undefined;
      })
      .sort((a, b) => a.slot.indexes[0] - b.slot.indexes[0]);
    if (members.length === 0) return null;
    const tiles = members.map((t) => this.entryOf(t.index)!.tile).join("");
    const place = members[members.length - 1].place();
    const anchor = place.position.clone();
    anchor.z += place.size.z / 2;
    anchor.y += place.size.y / 2;
    return { tiles, anchor };
  }

  /** 选中的 tileId，**按槽位从左到右**。T4.1 按这个顺序拼单词 */
  selectedTileIds(): number[] {
    return this.loose.flatMap((e) => (e && this.selectedTiles.has(e.tileId) ? [e.tileId] : []));
  }

  get hoveredThing(): number | null {
    return this.hovered;
  }

  /**
   * 换局（T6.3）：丢掉上一局的散牌区身份（tileId、白搭声明、groupKey）和一切本地交互状态，
   * 下一次 apply 从零铺开。`nextTileId` **不归零**——tileId 永不回收，跨局也一样。
   * 同一场的下一局 matchId 不变，`apply` 只在 matchId 变了才重读存档，所以要显式调它
   */
  resetGame(): void {
    this.cancelDrag();
    this.loose = [];
    this.lastSlotName.clear();
    this.selectedTiles.clear();
    this.focusedKey = null;
    this.chiTiles.clear();
    this.hovered = null;
    this.slides.clear();
    this.drawn.clear();
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
