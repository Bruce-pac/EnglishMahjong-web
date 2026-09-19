import { useEffect, useRef, useState } from "react";
import { Group, Mesh, MeshLambertMaterial, PlaneGeometry, Vector2, Vector3 } from "three";
import { Size, ThingType } from "./types";
import { api, ApiError, type AccountState, type Envelope, type MatchConfig, type Pending, type Result, type State } from "../api";
import { AssetLoader } from "./asset-loader";
import { WILD_CANDIDATES } from "./atlas";
import { SelectionValidator, type CheckState } from "./check";
import { ConfirmGate } from "./confirm";
import { claimSubmission, matchChi, matchHint, matchWin, type ChiMatch } from "./chi";
import { decisionKeyOf, HintPick } from "./hint-pick";
import { HintList, HintPanel, type Hint, type HintNote } from "./HintPanel";
import { groupKeyOf } from "./loose-reconcile";
import { canDiscard, canPass, type DiscardIntent } from "./discard";
import { WORLD_SIZE } from "./layout";
import { MainView } from "./main-view";
import { MouseUi } from "./mouse-ui";
import { ObjectView } from "./object-view";
import { openMatch } from "./open-match";
import * as persist from "./persist";
import { Settlement } from "./Settlement";
import { spellSelection } from "./spell";
import { gameIndexOf, TableView } from "./table-view";
import { dwellOf, pinnedFor, SAY_MS, sayOf, stepState } from "./replay";
import { Animation } from "./utils";
import { winMarkers, type WinMarker } from "./win-marker";
import { actorOf, boardModel, nextReplayActor } from "./board-model";
import { CenterBoard } from "./center-board";
import { CharacterLayer } from "./characters";
import { ConfigBar } from "./ConfigBar";
import { PrefsPanel } from "./PrefsPanel";
import { readHandCase, writeHandCase } from "./hand-case";

/**
 * 3D 页自己开局用的配置。
 *
 * 与首页那套设置界面（`App.tsx` 的 Setup）无关——3D 页目前是个独立入口，
 * 走的是「点进来就开一局」。接到正式的开局流程上是 T5.2 的事（那时才动 useGame）。
 */
const DEFAULT_CONFIG: MatchConfig = {
  tier: "junior",
  minWordLen: 2,
  minWinWordLen: 0,
  hints: false,
  bloody: true,
  difficulty: "normal",
  maxGames: 4,
};

/**
 * 现在是不是「用桌上那张牌拼一个词」的决策：吃牌（T6.1）或胡牌（T6.3）。
 * 两者共用同一套输入框、对应、校验、两步确认，只在规则（胡牌要用光散牌）和提交内容上不同
 */
function claimKindOf(p: Pending | null): "chi" | "win" | null {
  return p?.kind === "chi" || p?.kind === "win" ? p.kind : null;
}

/**
 * 新开的局用的配置。地址栏带 `?hints=1` 时打开提示（T6.2）——**只影响新开的局**：
 * 已有的局以服务端的 `state.config.hints` 为准，刷新回来也一样
 */
function configForNewMatch(): MatchConfig {
  const hints = new URLSearchParams(window.location.search).get("hints") === "1";
  return { ...DEFAULT_CONFIG, hints };
}

/**
 * 地址栏参数。`?match=<id>` 是和 2.5D 页共用的牌局 id；`?view=3d` 是给 App.tsx
 * 看的——没有它的话，带 match 参数刷新会被 2.5D 页接管（App.tsx 的恢复逻辑）。
 */
function readMatchId(): string | null {
  return new URLSearchParams(window.location.search).get("match");
}

function writeMatchId(matchId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("match", matchId);
  url.searchParams.set("view", "3d");
  history.replaceState(null, "", url);
}

/**
 * 把拉 envelope 时的错误翻成人话。
 *
 * 断网时 `fetch` 自己抛 TypeError、响应不是 JSON 时抛 SyntaxError——这两种都拿不到
 * ApiError，原文是「Failed to fetch」「Unexpected end of JSON input」，玩家看不懂；
 * 其余错误用服务端给的 detail。
 * 失败时**存档是保留着的**，所以要告诉玩家「可以重试」，而不是让他以为牌丢了。
 */
function describeFailure(e: unknown): string {
  if (e instanceof ApiError) return `恢复牌局失败：${e.message}（牌局和手牌顺序都还在，可以重试）`;
  if (e instanceof TypeError) return "连不上服务器（牌局和手牌顺序都还在，可以重试）";
  // 后端停着时，Vite 代理回的是空 body 的 5xx，`res.json()` 在构造 ApiError 之前就先抛了
  // SyntaxError。不在 `request()` 里改——那会改变 2.5D 在同一场景下看到的文案
  if (e instanceof SyntaxError) return "服务器没有正常响应（牌局和手牌顺序都还在，可以重试）";
  return `出错了：${e instanceof Error ? e.message : String(e)}`;
}

/**
 * 3D 牌桌页。
 *
 * 这里是**裸 three.js**，不用 @react-three/fiber：React 只负责挂一个容器 div 和
 * 页面周边的 DOM 覆盖层，渲染循环由本组件自己用 requestAnimationFrame 驱动（D11）。
 * 组件卸载时必须把循环停掉并 dispose 掉 GPU 资源，否则来回切页会漏显存。
 *
 * 本组件只做三件事：建场景、收键鼠、每帧推进相机动画并渲染。
 * 场景/相机/灯光/后处理都在 `main-view.ts`；牌是 T1.2；拾取在 `mouse-ui.ts`（T3.1）；
 * 拖放重排的状态在 `table-view.ts`（T3.2），这里只把鼠标按下 / 松开 / 移动喂给它。
 * 打牌（T3.4）的请求在这里发：TableView 只说「要打哪张」，本组件提交、拿回 envelope 再交还给它。
 * 单词校验（T4.1）：mainLoop 每帧把选中的牌推导成单词交给 `SelectionValidator`，变了才问服务端。
 */
/**
 * T6.6：账号 / 单词本 / 榜单三个弹窗由 `App` 渲染（账号状态机只留一份），3D 只经这些回调请求打开。
 * **3D 不 import `components/`**——数据和回调都从 props 进来
 */
export interface Table3DAccountProps {
  /** 登录态。null = 还没查到（或查失败），这时不出「保存成绩」 */
  account?: AccountState | null;
  /** 打开账号弹窗。牌局中只能注册：登录 / 退出会换掉本地身份，这局就接不上了 */
  onAccount?: () => void;
  onProfile?: () => void;
  onLeaderboard?: () => void;
}

/** App 的全屏弹窗（`.overlay`）开着：键盘快捷键别漏到牌桌上 */
function modalOpen(): boolean {
  return document.querySelector(".overlay") !== null;
}

export function Table3D({
  onBack,
  account = null,
  onAccount,
  onProfile,
  onLeaderboard,
}: { onBack: () => void } & Table3DAccountProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  /** 框选的选框。DOM 覆盖层而不是 3D 对象（研究笔记 §4.3：恒定面向屏幕的 UI 一律用 DOM） */
  const selectionRef = useRef<HTMLDivElement>(null);
  /** 单击暗词后出现在组旁的 [拆开]（T4.3）。每帧按投影位置定位，所以直接改 DOM 而不走 React state */
  const ungroupBtnRef = useRef<HTMLButtonElement>(null);
  const ungroupActRef = useRef<(() => void) | null>(null);
  /** 双击白搭弹出的字母选择器（T4.4）。字母表由 React 渲染，位置每帧直接改 DOM */
  const [wildPicker, setWildPicker] = useState<{ tileId: number; kind: "1" | "2" } | null>(null);
  const wildPickerRef = useRef<HTMLDivElement>(null);
  /** 选定一个字母：给那张白搭定字母（选择器和校验条里的就地选择器共用） */
  const wildActRef = useRef<((tileId: number, letter: string) => void) | null>(null);
  /** 出错了显示什么；`retry` 有值时给一个「重试」按钮（资源加载失败时没有，重试也没用） */
  const [failure, setFailure] = useState<{ message: string; retry?: () => void } | null>(null);
  const [wallLeft, setWallLeft] = useState<number | null>(null);
  /** 等吃 / 胡的决策、且能过时显示「过」（T3.4 的最小版本，正式界面是 T6.1 / T6.3） */
  const [passable, setPassable] = useState(false);
  /** 轮到自己出牌时在提示条上说一声 */
  const [myTurn, setMyTurn] = useState(false);
  /**
   * 顶部的一行提示，几秒后自己消失。`error` 是服务端拒绝操作（400 的 detail），
   * `info` 是操作成功的告知（「已组成暗词 …」），后者用中性样式，别让人以为出错了
   */
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  /** 「过」按钮要调 effect 闭包里的提交函数 */
  const passRef = useRef<(() => void) | null>(null);
  /** 校验条的状态。唯一的写入者是 SelectionValidator */
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  // ---- T4.2 组暗词 / 亮词 ----
  /** 有请求在途（打牌、过、组暗词、亮词共用一把锁） */
  const [busyUi, setBusyUi] = useState(false);
  /** 这一局结束了：组暗词不可用 */
  const [finished, setFinished] = useState(false);
  /** 现在是不是亮词决策（只读 pending，和 canDiscard 一样不判规则） */
  const [revealTurn, setRevealTurn] = useState(false);
  /** 亮词第二步（「确认亮出 …（不可撤回）」） */
  const [revealArmed, setRevealArmed] = useState(false);
  /** 缩写的全称输入。选区一变就清空 */
  const [expansion, setExpansion] = useState("");
  // ---- T6.1 吃牌（输入框模式）----
  /** 现在是不是吃牌决策（只读 pending），以及打出的是哪张 */
  const [chiTurn, setChiTurn] = useState(false);
  const [chiTile, setChiTile] = useState("");
  /** 这次是胡牌决策（T6.3）：按钮写「胡」、要用光散牌、提交 kind: "win" */
  const [claimWin, setClaimWin] = useState(false);
  /** 点了 [吃]：出输入框 */
  const [chiOpen, setChiOpen] = useState(false);
  const [chiInput, setChiInput] = useState("");
  /** 输入框的内容也放一份在 ref 里，mainLoop 每帧读它，不必等 React 重渲染 */
  const chiInputRef = useRef("");
  /** 对应失败的原因（凑不出 / 白搭超额）；对应成功时为 null */
  const [chiFail, setChiFail] = useState<Exclude<ChiMatch, { ok: true }>["reason"] | null>(null);
  /** 吃牌校验的结果（第二个校验器写） */
  const [chiCheck, setChiCheck] = useState<CheckState>({ status: "idle" });
  const [chiArmed, setChiArmed] = useState(false);
  const [chiExpansion, setChiExpansion] = useState("");
  const chiRef = useRef<{
    open: () => void;
    cancel: () => void;
    reveal: (expansion: string) => void;
    choose: (word: string) => void;
  } | null>(null);
  // ---- T6.3 结算 / 下一局 ----
  /** 这一局结束了（`env.result` 非空）：显示结算面板。刷新回来时服务端照样给 result，面板照样出来 */
  const [settle, setSettle] = useState<{ result: Result; state: State; matchFinished: boolean } | null>(null);
  const nextRef = useRef<(() => void) | null>(null);
  // ---- T6.2 提示 ----
  /** 本场开没开提示：以服务端 `state.config.hints` 为准。为假时页面上不出现任何提示入口 */
  const [hintsOn, setHintsOn] = useState(false);
  /** 本场玩法配置（T2.3a）。只认服务端下发的那份：本地开局配置在刷新恢复时是默认值 */
  const [config, setConfig] = useState<State["config"] | null>(null);
  // ---- T2.3b 偏好 ----
  /** ⚙ 面板开着没有。点图标、点面板外、按 Esc 都能收 */
  const [prefsOpen, setPrefsOpen] = useState(false);
  /** 手牌区小写。**全局偏好**，跨局跨场跨刷新，见 hand-case.ts */
  const [lowercase, setLowercase] = useState(readHandCase);
  const lowercaseRef = useRef(lowercase);
  /** 切大小写：写全局键 + 让 TableView 立刻重画（effect 里挂上来） */
  const caseRef = useRef<((lowercase: boolean) => void) | null>(null);
  /** 这一次决策服务端给的提示（提示关闭时恒为空） */
  const [hintList, setHintList] = useState<Hint[]>([]);
  const [hintOpen, setHintOpen] = useState(false);
  /** 点过的那个提示词（viaHint 靠它判定） */
  const [hintPicked, setHintPicked] = useState<string | null>(null);
  /**
   * 每条提示后面的注明（按单词）：已经是自己的暗词 →「已组成暗词」；要借用暗词里的牌 →「要先拆开暗词」。
   * 只用散牌就对应得上的不在表里
   */
  const [hintNotes, setHintNotes] = useState<Record<string, HintNote>>({});
  const hintRef = useRef<{ pick: (h: Hint) => void } | null>(null);
  // ---- T6.5 血战到底 ----
  /** 自己胡了或已结算：散牌区锁住，操作区不出按钮 */
  const [locked, setLocked] = useState(false);
  /** 正在回放别家的动作（T5.2）：本地操作照常，提交按钮灰掉、旁边注明「等别家出完」 */
  const [replayingUi, setReplayingUi] = useState(false);
  /** 已胡各家的「第 N 胡」。文字由 React 渲染，位置每帧直接改 DOM（同 [拆开]） */
  const [winMarks, setWinMarks] = useState<WinMarker[]>([]);
  const markerEls = useRef(new Map<number, HTMLDivElement>());
  /** 回放时各家头上的气泡（「亮 WINDOW」「吃 Z」「胡」）。文字由 React 渲染，位置每帧直接改 DOM */
  const [bubbles, setBubbles] = useState<Record<number, { text: string; out: boolean; key: number }>>({});
  const bubbleEls = useRef(new Map<number, HTMLDivElement>());
  const actionsRef = useRef<{
    group: (expansion: string) => void;
    reveal: (expansion: string) => void;
    cancel: () => void;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    const selectionEl = selectionRef.current;
    const ungroupEl = ungroupBtnRef.current;
    if (!mount || !selectionEl || !ungroupEl) return;

    // 世界坐标那一层。桌面和牌都挂这里，永不旋转（换座位转的是相机组）
    const mainGroup = new Group();
    mainGroup.matrixAutoUpdate = false;

    // 桌面，右手系、z 向上。
    //
    // 边长比槽位区多一个牌高（照 Autotable 的 `WIDTH + Size.TILE.y`）：贴着桌沿的
    // 散牌区外面留一圈台面，牌看起来才是「摆在桌上」而不是「悬在边缘」。
    //
    // WORLD_SIZE 是 222，不是 Autotable 的 174——我们每家要摆的东西多得多
    // （18 格散牌区、14 格亮词行、15 墩牌墙），见 layout.ts 的推导。
    const tableSize = WORLD_SIZE + Size[ThingType.TILE].y;
    const tableGeometry = new PlaneGeometry(tableSize, tableSize);
    const tableMaterial = new MeshLambertMaterial({ color: 0x1d6b4a });
    const table = new Mesh(tableGeometry, tableMaterial);
    // 槽位坐标是 0..WORLD_SIZE，桌面几何以原点为中心，所以要挪半个身位对上
    table.position.set(WORLD_SIZE / 2, WORLD_SIZE / 2, 0);
    table.matrixAutoUpdate = false;
    table.updateMatrix();
    mainGroup.add(table);

    const view = new MainView(mount, mainGroup);

    // T2.2 中央记分盘：一张贴图平面，不进 Thing 池、不参与拾取。挂在 mainGroup 上，
    // 按 p 切透视重建的只是相机与后处理链，场景树不动，盘还在
    const board = new CenterBoard(document.createElement("canvas"), view.maxAnisotropy);
    mainGroup.add(board.mesh);
    board.mesh.updateMatrixWorld(true); // 全手动矩阵（main-view.ts），加进来要自己算一次

    // T2.3d 三个 AI 角色：只在透视模式显示，第一次切到透视才下载（正交的玩家一个字节都不多下）
    const cast = new CharacterLayer(mainGroup);

    // ---- 相机的三个连续参数（D13）----
    // 全部由 Animation 驱动，150ms 缓动。瞬切很晕，而且看不出是自己按的
    const lookDown = new Animation(150);
    const zoom = new Animation(150);
    /** 鼠标在画面里的归一化坐标（-1..1）。放大时相机跟着它平移，拾取也用这一份 */
    const mouse2 = new Vector2(0, 0);
    let hasMouse = false;
    /** 已按下的键。按住不放时浏览器会重复触发 keydown，用它去重 */
    const keys = new Set<string>();

    const onMouseMove = (e: MouseEvent) => {
      const rect = view.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      mouse2.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      );
      hasMouse = true;
    };
    const onMouseLeave = () => {
      hasMouse = false;
    };
    // ---- T3.3 框选 ----
    /** 选框起点，按桌面（z=0）上的世界坐标记，每帧重新投影——镜头动了选框也跟着桌面走 */
    let selectStart3: Vector3 | null = null;
    /** 按下时的屏幕位置。挪过几个像素才算「拖了」，否则就是单击 */
    let selectDown: { x: number; y: number } | null = null;
    let selectMoved = false;

    // ---- T4.4 双击白搭赋值 ----
    /** 选择器正开着的那张白搭。null = 没开 */
    let pickerTile: number | null = null;
    const openWildPicker = (tileId: number, kind: "1" | "2") => {
      pickerTile = tileId;
      setWildPicker({ tileId, kind });
    };
    const closeWildPicker = () => {
      if (pickerTile === null) return;
      pickerTile = null;
      setWildPicker(null);
    };
    // 双击散牌区里的白搭 → 在牌旁弹字母选择器。双击普通字母牌、暗词里的白搭都不响应
    //
    // 不能读 hoveredThing：双击的两次按下都会先进入拖动（dragStart 清掉悬停），悬停要到下一帧
    // 渲染时才恢复，而 dblclick 紧跟在第二次松手之后、同一个任务里触发——那时悬停还是 null。
    // 所以当场拿鼠标坐标拾取一次
    const onDblClick = () => {
      if (!tableView || !mouseUi || tableView.dragging || !hasMouse) return;
      mouseUi.updateObjects(tableView.pickables);
      const picked = mouseUi.pick(mouse2, view.camera);
      if (picked === null) return;
      const info = tableView.wildPickerAt(picked);
      if (info) openWildPicker(info.tileId, info.kind);
    };

    // ---- T4.3 单击暗词 ----
    /** 在牌上按下的位置和那张牌。松手时没挪动超过 3px 就算单击（和框选同一个阈值） */
    let tileDown: { x: number; y: number; thing: number } | null = null;
    let tileMoved = false;

    const endSelection = () => {
      selectStart3 = null;
      selectDown = null;
      selectMoved = false;
      selectionEl.style.visibility = "hidden";
    };

    // 在悬停的牌上按下 → 拿起（T3.2）。拖动平面抬到那张牌的顶面（研究笔记 §4.2）。
    // 在空白处按下 → 开始框选（T3.3）
    const onMouseDown = (e: MouseEvent) => {
      // 在画面上按下（点别处、开始拖动）都关掉字母选择器。选择器本身在画布外面，点它不会走到这里
      closeWildPicker();
      setPrefsOpen(false); // 点画面别处就收起 ⚙ 面板（面板本身在画布外，点它不会走到这里）
      if (e.button !== 0 || !tableView || !mouseUi || !hasMouse) return;
      if (tableView.hoveredThing !== null) {
        const z = tableView.dragZ;
        if (z === null) return;
        const thing = tableView.hoveredThing;
        const p = mouseUi.raycastLevel(mouse2, view.camera, z);
        if (p && tableView.dragStart(p)) {
          // 只拦 mousedown 的默认行为（文字选区），不碰 click / dblclick——T4.4 要用双击给白搭赋值
          e.preventDefault();
          tileDown = { x: e.clientX, y: e.clientY, thing };
          tileMoved = false;
        }
        return;
      }
      // 锁住时（回放中 / 自己胡了 / 结算中）没有可拾取的牌，按下会落到这里——框选也不开始
      if (tableView.isLocked) return;
      const p = mouseUi.raycastLevel(mouse2, view.camera, 0);
      if (!p) return;
      selectStart3 = p;
      selectDown = { x: e.clientX, y: e.clientY };
      tableView.clearFocusedGroup(); // 开始框选，[拆开] 就收起来
      selectMoved = false;
      tableView.setHovered(null); // 框选过程中不显示悬停
      e.preventDefault();
    };
    // 松开挂在 window 上：拖出画布再松手也得收得到
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (selectStart3) {
        // 单击空白处（没拖动）= 清空选中
        if (!selectMoved) tableView?.clearSelection();
        endSelection();
        return;
      }
      const intent = tableView?.dragEnd();
      if (intent) submitDiscard(intent);
      // 在暗词的牌上按下又松开、没挪动 → 选中这个暗词，组旁出 [拆开]
      if (tileDown && !tileMoved) tableView?.focusGroupAt(tileDown.thing);
      tileDown = null;
    };
    // 右键悬停中的散牌 = 打这张。和拖到牌河走同一个提交入口
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (!tableView || tableView.dragging || selectStart3) return;
      const hovered = tableView.hoveredThing;
      if (hovered === null) return;
      // 暗词里的牌不单独打：服务端只认字母，散牌里有同字母的牌时它会打掉那张，所以前端先拦，不发请求
      if (tableView.inGroup(hovered)) {
        showNotice("暗词里的牌不能单独打，先拆开");
        return;
      }
      if (tableView.isSubmitLocked) {
        showNotice("等别家出完再出牌", "info");
        return;
      }
      const intent = tableView.discardIntentOf(hovered);
      if (intent) submitDiscard(intent);
    };
    const onWindowMouseMove = (e: MouseEvent) => {
      if (selectDown && !selectMoved) {
        selectMoved = Math.hypot(e.clientX - selectDown.x, e.clientY - selectDown.y) > 3;
      }
      if (tileDown && !tileMoved) {
        tileMoved = Math.hypot(e.clientX - tileDown.x, e.clientY - tileDown.y) > 3;
      }
    };

    /** 每帧：选框投回屏幕、画 DOM 矩形、算框中了哪几张 */
    const updateSelection = () => {
      if (!selectStart3 || !tableView || !mouseUi) return;
      if (!selectMoved) return;
      mouseUi.updateObjects(tableView.pickables);
      const start2 = mouseUi.project(selectStart3, view.camera);
      tableView.setSelected(mouseUi.select(start2, mouse2, view.camera));

      const rect = view.canvas.getBoundingClientRect();
      const toX = (x: number) => rect.left + ((x + 1) / 2) * rect.width;
      const toY = (y: number) => rect.top + ((1 - y) / 2) * rect.height;
      const x1 = toX(Math.min(start2.x, mouse2.x));
      const x2 = toX(Math.max(start2.x, mouse2.x));
      const y1 = toY(Math.max(start2.y, mouse2.y));
      const y2 = toY(Math.min(start2.y, mouse2.y));
      selectionEl.style.left = `${x1}px`;
      selectionEl.style.top = `${y1}px`;
      selectionEl.style.width = `${x2 - x1}px`;
      selectionEl.style.height = `${y2 - y1}px`;
      selectionEl.style.visibility = "visible";
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // 输入框里打字不该把镜头晃起来（T6.1 的吃牌输入框就是个 input）
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // App 的账号 / 单词本 / 榜单弹窗开着（T6.6）：p、空格、z/x、Esc 都不该动牌桌
      if (modalOpen()) return;
      if (e.key === "Escape") {
        closeWildPicker();
        setPrefsOpen(false);
      }
      if (keys.has(e.key)) return;
      keys.add(e.key);

      switch (e.key) {
        case " ":
          lookDown.start(1);
          e.preventDefault(); // 空格默认会滚动页面
          break;
        case "z":
          zoom.start(1);
          break;
        case "x":
          zoom.start(-1);
          break;
        case "p":
          view.setPerspective(!view.isPerspective);
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key);
      // 松开就回弹。不判 activeElement——按下时在画布上、松开时焦点跑了的话，
      // 不回弹会让镜头永远卡在低头状态
      if (e.key === " " || e.key === "z" || e.key === "x") {
        (e.key === " " ? lookDown : zoom).start(0);
      }
    };
    // 切到别的标签页再回来，keyup 收不到，键会卡住
    const onBlur = () => {
      // 切走时 mouseup 也收不到：手上的牌放回原位，框选也放弃（已选中的保留）
      tableView?.cancelDrag();
      endSelection();
      keys.clear();
      lookDown.start(0);
      zoom.start(0);
    };

    mount.addEventListener("mousemove", onMouseMove);
    mount.addEventListener("mouseleave", onMouseLeave);
    mount.addEventListener("mousedown", onMouseDown);
    mount.addEventListener("contextmenu", onContextMenu);
    mount.addEventListener("dblclick", onDblClick);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    // 牌和拾取都要等资源加载完才有，mainLoop 在那之前只画空桌
    let objectView: ObjectView | null = null;
    let tableView: TableView | null = null;
    let mouseUi: MouseUi | null = null;

    // ---- T3.4 打牌 ----
    let matchId: string | null = null;
    let pending: Pending | null = null;
    /** 请求没回来之前锁住提交，防止连打两张 */
    let busy = false;
    /** 这一局结束了（结算页前的最终局面） */
    let finishedFlag = false;
    // ---- T6.2 提示 ----
    const hintPick = new HintPick();
    let hintDecision = "";
    /** 本场开没开提示（effect 里读；界面上用的是 hintsOn 状态） */
    let hintsOnFlag = false;
    /** 「第 N 胡」标记（mainLoop 每帧按它投影） */
    let marks: WinMarker[] = [];
    let noticeTimer = 0;

    const showNotice = (message: string, tone: "error" | "info" = "error") => {
      setNotice({ text: message, tone });
      window.clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => setNotice(null), 3500);
    };

    /** 按 pending 和锁的状态刷新：牌河是不是合法落点、要不要显示「过」 */
    const refreshControls = () => {
      tableView?.setDiscardAllowed(canDiscard(pending, busy));
      setPassable(canPass(pending, busy));
      setMyTurn(canDiscard(pending, false));
      setBusyUi(busy);
      setRevealTurn(pending?.kind === "reveal");
      const claim = claimKindOf(pending);
      setChiTurn(claim !== null);
      setClaimWin(claim === "win");
      setChiTile(claim ? (pending!.tile ?? "") : "");
      setFinished(finishedFlag);
    };

    // ---- T5.1 事件回放 ----
    /** 画面现在对应的 state，以及它属于哪一场的哪一局。回放从这里出发 */
    let shownState: State | null = null;
    let shownGame = "";
    /** 正在回放。回放期间又来了 envelope：先快进到底再处理 */
    let replaying: Promise<void> | null = null;
    let fastForward = false;
    /** 回放进行中（右键打牌时给句提示用；界面上用的是 replayingUi） */
    let replayingFlag = false;
    // 气泡：同一家新气泡顶掉旧的；停 SAY_MS 后淡出 0.3s 再撤掉（同 Mahjong 项目的 say-ui）
    const bubbleTimers = new Map<number, number>();
    let bubbleKey = 0;
    const say = (seat: number, text: string) => {
      window.clearTimeout(bubbleTimers.get(seat));
      const key = ++bubbleKey;
      setBubbles((b) => ({ ...b, [seat]: { text, out: false, key } }));
      bubbleTimers.set(
        seat,
        window.setTimeout(() => {
          setBubbles((b) => ({ ...b, [seat]: { text, out: true, key } }));
          bubbleTimers.set(
            seat,
            window.setTimeout(() => {
              setBubbles((b) => {
                const next = { ...b };
                delete next[seat];
                return next;
              });
            }, 300),
          );
        }, SAY_MS),
      );
    };

    /**
     * 把 envelope 画到桌上。带 events 的逐个事件回放：每步 `stepState` 推一格、
     * 交给 tableView（pinned 指定背面牌从哪飞出来），间隔 REPLAY_STEP_MS；最后一步用真 envelope 对齐
     * （它才带 pending、result、自己补摸的牌）。回放期间锁住散牌区，相机照常。
     * 刷新、开新局、换局时 events 对不上画面（没有出发点），直接跳到最终状态
     */
    const replayEvents = async (env: Envelope, consumedTileIds: readonly number[]) => {
      if (replaying) {
        fastForward = true;
        await replaying;
      }
      const game = `${env.matchId}|${gameIndexOf(env)}`;
      let consumed = consumedTileIds;
      if (shownState && shownGame === game && env.events.length > 0) {
        let done = () => {};
        replaying = new Promise<void>((f) => (done = f));
        fastForward = false;
        pending = null;
        // T5.2：回放期间只锁提交（busy 本来就为真，服务端请求一个都发不出去；拖到牌河当非法落点），
        // 拖动重排、框选、白搭赋值、点提示照常。setLocked 只留给「自己胡了 / 结算中」
        tableView!.setSubmitLocked(true);
        replayingFlag = true;
        setReplayingUi(true);
        refreshControls();
        let s = shownState;
        /** 记分盘上亮哪一边：当前事件的座位，没有座位的事件（exhausted）保持上一步 */
        let replayActor: number | null = null;
        try {
          for (const e of env.events) {
            if (fastForward || !alive) break;
            // 自己发起的动作带的 tileId 交给处理自己那个事件的那一步：打牌 → discard，亮词 / 吃牌 → reveal
            const own = e.seat === s.me.seat && consumed.length > 0 && (e.t === "discard" || e.t === "reveal");
            const ids = own ? consumed : [];
            const at = own && e.t === "discard" ? tableView!.looseSlots.findIndex((x) => x?.tileId === ids[0]) : -1;
            const next = stepState(s, e);
            tableView!.apply(
              { ...env, state: next, pending: null, result: null },
              ids,
              pinnedFor(s, e, at >= 0 ? `loose.${at}@${s.me.seat}` : undefined),
            );
            if (own) consumed = [];
            s = next;
            replayActor = nextReplayActor(replayActor, e);
            const stepEnv = { ...env, state: next, pending: null, result: null };
            const actor = actorOf(stepEnv, replayActor);
            board.update(boardModel(stepEnv, actor));
            cast.setActor(actor); // 前倾和记分盘的亮边同一家
            const line = sayOf(e);
            if (line && e.seat !== undefined) say(e.seat, line);
            // 牌 180ms 飞到位，剩下的时间静止；吃、亮词、胡停得更久，气泡读得完
            await new Promise((f) => setTimeout(f, dwellOf(e)));
          }
        } finally {
          replaying = null;
          done();
        }
        if (!alive) return;
      }
      tableView!.apply(env, consumed);
      // 最后一步已经对齐真值，解开提交锁；控件随后由 applyEnvelope 按真 envelope 刷新
      tableView!.setSubmitLocked(false);
      if (replayingFlag) {
        replayingFlag = false;
        setReplayingUi(false);
      }
      shownState = env.state;
      shownGame = game;
    };

    /** 吃进 envelope。带 events 的先回放（T5.1），再按真 envelope 刷新界面 */
    const applyEnvelope = async (env: Envelope, consumedTileIds: readonly number[] = []) => {
      await replayEvents(env, consumedTileIds);
      if (!alive) return;
      matchId = env.matchId;
      pending = env.pending;
      finishedFlag = env.matchFinished || env.result !== null;
      // T6.5：自己胡了 / 结算中锁住散牌区。现在服务端会立刻返回结算，这是兜底；T5 加回放后才真正用上
      const lock = env.state.me.won || env.result !== null;
      tableView!.setLocked(lock);
      if (lock) closeWildPicker();
      setLocked(lock);
      marks = winMarkers(env.state);
      setWinMarks(marks);
      // 决策换了（吃成了、过了、别家先胡了、或者换成了别的牌），输入框和高亮一起收掉。
      // 只看「决策类型 + 那张牌」：决策期间组暗词、拆暗词也会来 envelope，散牌变了但输入不该丢，
      // 对应会随散牌区自动重算
      const claimSig = claimKindOf(pending) ? `${pending!.kind}|${pending!.tile}` : "";
      if (claimSig !== lastClaimSig) {
        closeChi();
        lastClaimSig = claimSig;
      }
      setWallLeft(env.state.wallLeft);
      // 回放结束（或没有回放）：按真 envelope 决定亮哪边——结算不亮、有 pending 亮自己、其余照 turn
      board.update(boardModel(env, actorOf(env, null)));
      cast.setActor(actorOf(env, null));
      setHintsOn(env.state.config.hints);
      setConfig(env.state.config);
      hintsOnFlag = env.state.config.hints;
      // 提示：决策换了（摸了新牌、轮到别家）就清掉点过的词、收起列表、取消高亮
      const decision = decisionKeyOf(env);
      if (decision !== hintDecision) {
        hintDecision = decision;
        hintPick.sync(decision);
        setHintPicked(null);
        setHintOpen(false);
        if (claimKindOf(pending) === null) tableView?.setHighlight([]);
      }
      const hints = env.pending?.hints ?? [];
      setHintList(hints);
      // 散牌区变了（组了、拆了暗词）会影响每条提示的注明，每个 envelope 都重算。
      // 服务端用整手牌算提示，暗词里的牌也算进去：玩家自己组好的 FIX 也会出现在列表里——
      // 这时它不是「要先拆开暗词」（那等于让人把刚组好的词拆掉），而是「已组成暗词」
      const notes: Record<string, HintNote> = {};
      if (tableView) {
        const loose = tableView.looseSlots;
        const myGroups = new Set(loose.flatMap((e) => (e?.groupKey ? [e.groupKey] : [])));
        for (const h of hints) {
          const ok =
            pending?.kind === "chi" && pending.tile
              ? matchChi(loose, h.word, pending.tile).ok
              : matchHint(loose, h.word, h.wild).ok;
          if (ok) continue;
          notes[h.word] = myGroups.has(groupKeyOf(h.tiles, h.word))
            ? { text: "已组成暗词", tone: "info" } // 中性的告知：灰绿色
            : { text: "要先拆开暗词", tone: "warn" };
        }
      }
      setHintNotes(notes);
      setSettle(env.result ? { result: env.result, state: env.state, matchFinished: env.matchFinished } : null);
      refreshControls();
    };

    /**
     * 提交一个决策。服务端 400 时显示它给的原话、局面不动（拖出去的牌早已滑回原位）。
     * 规则一律由服务端判——比如白搭能不能打，前端照常提交。
     */
    const submit = async (
      call: (id: string) => Promise<Envelope>,
      consumedTileIds: readonly number[] = [],
      beforeApply?: () => void,
    ): Promise<boolean> => {
      if (!matchId || busy) return false;
      busy = true;
      refreshControls();
      try {
        const env = await call(matchId);
        if (!alive) return false;
        beforeApply?.();
        // 回放期间 busy 一直是真的：提交锁到回放结束
        await applyEnvelope(env, consumedTileIds);
        return true;
      } catch (e) {
        if (alive) showNotice(e instanceof ApiError ? e.message : describeFailure(e));
        return false;
      } finally {
        busy = false;
        if (alive) refreshControls();
      }
    };
    const act = (body: Parameters<typeof api.act>[1], consumedTileIds: readonly number[] = []) =>
      submit((id) => api.act(id, body), consumedTileIds);

    /** 拖到牌河、右键，都走这里。带上 tileId 给对账消歧（重复字母时空出的是打出去的那格） */
    const submitDiscard = (intent: DiscardIntent) => {
      if (!canDiscard(pending, busy)) return;
      if (replayingFlag) return; // 兜底：回放期间 busy 为真、上一行已经挡住，不发请求
      void act({ kind: "discard", tile: intent.tile }, [intent.tileId]);
    };

    passRef.current = () => {
      if (!canPass(pending, busy)) return;
      closeChi();
      void act({ kind: "pass" });
    };

    // ---- T4.1 单词校验 ----
    // 结果只有一个来源：mainLoop 每帧喂最新的推导结果，校验器按 key 比对、变了才发请求。
    // 框选松手、单击空白清空、拖牌清空选中、envelope 剪掉离开的牌、打出一张被选中的牌——
    // 这些路径都只是改了选中集合或 LooseSlots，下一帧自然算出新 key，不在各自的回调里手动发请求。
    // 不看 pending、不受 busy 锁：校验是只读的提问
    /** 校验器最新的状态。按钮提交时用它的 tiles / word（T4.1 推导结果，不从校验响应里拼） */
    let current: CheckState = { status: "idle" };
    /** 亮词两步确认：选区（key）一变就退回第一步 */
    const gate = new ConfirmGate();
    const validator = new SelectionValidator(
      (tiles, word) =>
        matchId ? api.validate(matchId, tiles, word) : Promise.reject(new Error("牌局还没开始")),
      (state) => {
        if (!alive) return;
        const key = state.status === "idle" ? "none" : state.key;
        const prevKey = current.status === "idle" ? "none" : current.key;
        current = state;
        gate.sync(key);
        if (key !== prevKey) setExpansion("");
        setRevealArmed(gate.armed);
        setCheck(state);
      },
      (e) => {
        if (alive) showNotice(e instanceof ApiError ? e.message : describeFailure(e));
      },
    );

    // ---- T6.1 吃牌 ----
    // 结果同样只有一个来源：mainLoop 每帧用输入框的内容对应一次，喂给第二个校验器。
    // 对应失败（凑不出 / 白搭超额）不发请求，只记原因；不列候选、不说差哪张（教学红线）
    let chiOpenFlag = false;
    let lastClaimSig = "";
    let chiMatch: ChiMatch = { ok: false, reason: "empty" };
    let chiKey = "";
    let chiCurrent: CheckState = { status: "idle" };
    const chiGate = new ConfirmGate();
    const chiValidator = new SelectionValidator(
      (tiles, word) =>
        matchId && claimKindOf(pending) && pending?.tile
          ? api.validate(matchId, tiles, word, pending.tile)
          : Promise.reject(new Error("现在不是吃牌或胡牌决策")),
      (state) => {
        if (!alive) return;
        chiCurrent = state;
        setChiCheck(state);
      },
      (e) => {
        if (alive) showNotice(e instanceof ApiError ? e.message : describeFailure(e));
      },
    );
    function closeChi(): void {
      if (!chiOpenFlag && chiInputRef.current === "") return;
      chiOpenFlag = false;
      chiInputRef.current = "";
      chiKey = "";
      chiGate.reset();
      setChiOpen(false);
      setChiInput("");
      setChiFail(null);
      setChiArmed(false);
      setChiExpansion("");
      tableView?.setHighlight([]);
    }
    /** mainLoop 每帧调：对应 → 高亮 → 校验。key 没变什么都不做 */
    const updateChi = () => {
      if (!tableView) return;
      const kind = claimKindOf(pending);
      if (!chiOpenFlag || !kind || !pending?.tile) {
        chiValidator.update({ kind: "none" });
        return;
      }
      const input = chiInputRef.current;
      // 胡牌另加一条：必须用光全部散牌
      chiMatch = (kind === "win" ? matchWin : matchChi)(tableView.looseSlots, input, pending.tile);
      const key = `${input}|${chiMatch.ok ? chiMatch.tiles : chiMatch.reason}`;
      if (key === chiKey) return;
      if (chiKey.split("|")[0] !== input) setChiExpansion("");
      chiKey = key;
      chiGate.sync(key); // 输入一变就退回第一步
      setChiArmed(false);
      setChiFail(chiMatch.ok || chiMatch.reason === "empty" ? null : chiMatch.reason);
      tableView.setHighlight(chiMatch.ok ? chiMatch.tileIds : []);
      chiValidator.update(
        chiMatch.ok ? { kind: "word", tiles: chiMatch.handTiles, word: input.trim().toLowerCase() } : { kind: "none" },
      );
    };
    chiRef.current = {
      open: () => {
        if (!claimKindOf(pending)) return;
        chiOpenFlag = true;
        setChiOpen(true);
      },
      cancel: () => closeChi(),
      /** 提示模式：点了某个候选词，等同于把它填进输入框 */
      choose: (word: string) => {
        chiInputRef.current = word;
        setChiInput(word);
      },
      reveal: (exp) => {
        if (!chiMatch.ok || chiCurrent.status !== "done" || !chiCurrent.result.valid) return;
        const kind = claimKindOf(pending);
        if (!kind || busy) return;
        // 「亮出的词至少 3 个字母」只管吃牌；胡牌由服务端判
        if (kind === "chi" && chiCurrent.result.canReveal === false) return;
        // 亮词、胡牌都不可撤回：第一次点只上膛，不发请求
        if (!chiGate.press()) {
          setChiArmed(chiGate.armed);
          return;
        }
        setChiArmed(false);
        // 提交内容和对账要移除哪几张，由纯函数 claimSubmission 决定（单测钉着）：
        // 吃牌移除对应出来的那几张；胡牌不移除（牌不离开手牌）；提示模式的吃牌带 viaHint
        const sub = claimSubmission(kind, chiMatch, chiCurrent.word, exp || undefined, kind === "chi" && hintsOnFlag);
        void submit((id) => api.act(id, sub.body), sub.consumedTileIds);
      },
    };

    // 点了某个提示词：记下它（viaHint），高亮它会用到的散牌。只高亮，不替玩家排牌、不自动选中
    hintRef.current = {
      pick: (h) => {
        hintPick.pick(h.word);
        setHintPicked(hintPick.word);
        const m = tableView ? matchHint(tableView.looseSlots, h.word, h.wild) : null;
        tableView?.setHighlight(m?.ok ? m.tileIds : []);
      },
    };

    // ---- T6.3 下一局 ----
    // 同一场的下一局 matchId 不变，而 TableView 只在 matchId 变了才重读存档——不先清掉的话，
    // 上一局的散牌区身份（tileId、白搭声明、groupKey）会被带进新一局去对账。
    // 所以服务端返回后、对账之前，先让它丢掉上一局；页面上的输入框、选择器一并收起。
    // 校验条、组词按钮、[拆开]、亮词确认态靠「选中和聚焦被清空」自己回到初始状态
    nextRef.current = () => {
      void submit(
        (id) => api.nextGame(id),
        [],
        () => {
          tableView?.resetGame();
          shownState = null; // 新一局的 events 从空桌开始，不接上一局的画面
          closeChi();
          closeWildPicker();
        },
      );
    };

    // ---- T4.2 组暗词 / 亮词 / 取消 ----
    // 规则一律交给服务端：选中的牌里有暗词的牌、亮词数量到上限这类情况，前端不预判，400 原样显示
    actionsRef.current = {
      group: (exp) => {
        if (current.status !== "done" || !current.result.valid || finishedFlag) return;
        const ids = tableView!.selectedTileIds();
        const { tiles, word } = current;
        void submit(
          // 只有提交的正是点过的那个提示词才算被提示（和 2.5D 一样）
          (id) => api.group(id, tiles, word, hintPick.viaHint(word), exp || undefined),
          [],
          // 对账之前把暗词 key 写到选中的那几张上，配对才会认准它们
          // 然后收拢：成员向左连成一块（框选只能框连续一段，只会挪进成员之间的空格）
          () => {
            tableView!.markGroup(ids, tiles, word);
            tableView!.compactGroup(ids);
          },
        ).then((ok) => {
          if (!ok || !alive) return;
          tableView?.clearSelection();
          showNotice(`已组成暗词 ${word.toUpperCase()}`, "info");
        });
      },
      reveal: (exp) => {
        if (current.status !== "done" || !current.result.valid) return;
        if (pending?.kind !== "reveal" || busy) return;
        // 亮词不可撤回：第一次点只上膛，不发请求
        if (!gate.press()) {
          setRevealArmed(gate.armed);
          return;
        }
        setRevealArmed(false);
        const ids = tableView!.selectedTileIds();
        const { tiles, word } = current;
        const viaHint = hintPick.viaHint(word) || undefined;
        void submit((id) => api.act(id, { kind: "reveal", tiles, word, viaHint, expansion: exp || undefined }), ids);
      },
      cancel: () => {
        gate.reset();
        setRevealArmed(false);
        tableView?.clearSelection();
      },
    };

    wildActRef.current = (tileId, letter) => {
      tableView?.declareWildTile(tileId, letter);
      closeWildPicker();
    };

    // [拆开]：成功后牌原地不动，只是框没了（groupKey 由对账清掉）
    ungroupActRef.current = () => {
      const info = tableView?.focusedGroupInfo();
      if (!info) return;
      void submit((id) => api.ungroup(id, info.tiles)).then((ok) => {
        if (ok && alive) tableView?.clearSelection();
      });
    };

    // 自建 mainLoop：每帧推进动画、对齐画布、摆相机、拾取、渲染
    let raf = 0;
    const mainLoop = () => {
      raf = requestAnimationFrame(mainLoop);
      lookDown.update();
      zoom.update();
      view.updateViewport();
      // 单人对局座位恒为 0（需求文档 §1：1 真人 + 3 AI）
      view.updateCamera(0, lookDown.pos, zoom.pos, hasMouse ? mouse2 : null);
      if (tableView && mouseUi) {
        // 每帧都拾取，不只在 mousemove 时：低头、缩放会让同一个鼠标位置指到别的牌。
        // 相机也每帧现取——按 p 切透视时 main-view 会换掉相机对象
        if (selectStart3) {
          updateSelection();
        } else if (tableView.dragging) {
          // 拖动中只信平面（研究笔记 §4.2）。鼠标出了画布就停在最后的位置
          const p = hasMouse ? mouseUi.raycastLevel(mouse2, view.camera, tableView.dragZ!) : null;
          tableView.dragMove(p);
        } else {
          mouseUi.updateObjects(tableView.pickables);
          tableView.setHovered(hasMouse ? mouseUi.pick(mouse2, view.camera) : null);
        }
        tableView.update(performance.now());
        // 框选拖动过程中不校验（每帧都在变，逐帧发请求会刷爆服务端），松手后才算选定
        if (!selectStart3) {
          validator.update(spellSelection(tableView.looseSlots, tableView.selectedTileIds()));
        }
        updateChi();
        // 选中的牌描金边。objectView.selectedObjects 每次提交都会重填，交同一个数组即可
        if (objectView) {
          view.updateOutline(objectView.selectedObjects);
          view.updateGroupOutline(objectView.groupedObjects);
        }
        // 字母选择器跟着那张白搭走；那张牌离开了散牌区（打出、亮出）就关掉
        if (pickerTile !== null) {
          const anchor = tableView.wildAnchorOf(pickerTile);
          const el = wildPickerRef.current;
          if (!anchor) {
            closeWildPicker();
          } else if (el) {
            const p = mouseUi.project(anchor, view.camera);
            const rect = view.canvas.getBoundingClientRect();
            el.style.left = `${rect.left + ((p.x + 1) / 2) * rect.width}px`;
            el.style.top = `${rect.top + ((1 - p.y) / 2) * rect.height}px`;
            el.style.visibility = "visible";
          }
        }
        // [拆开] 跟着暗词走：锚点每帧重新投影，镜头缩放、低头时也贴着组
        const focused = tableView.dragging ? null : tableView.focusedGroupInfo();
        if (focused) {
          const p = mouseUi.project(focused.anchor, view.camera);
          const rect = view.canvas.getBoundingClientRect();
          ungroupEl.style.left = `${rect.left + ((p.x + 1) / 2) * rect.width}px`;
          ungroupEl.style.top = `${rect.top + ((1 - p.y) / 2) * rect.height}px`;
          ungroupEl.style.visibility = "visible";
        } else {
          ungroupEl.style.visibility = "hidden";
        }
        // 回放气泡跟着座位走，锚点同「第 N 胡」。优先放在锚点上方（让开「第 N 胡」）；
        // 对家那排贴着画面上沿，上方放不下就翻到牌排下方。左右夹在窗口里——右家亮个长词不能出屏
        for (const [seat, el] of bubbleEls.current) {
          // 透视且角色已加载：从角色头顶冒出；否则（含正交）照旧在牌排上方
          const p = mouseUi.project(cast.bubbleAnchor(seat) ?? tableView.looseRowAnchor(seat), view.camera);
          const rect = view.canvas.getBoundingClientRect();
          const ax = rect.left + ((p.x + 1) / 2) * rect.width;
          const ay = rect.top + ((1 - p.y) / 2) * rect.height;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          const margin = 8;
          const above = ay - 34 - h / 2;
          const cy = above - h / 2 >= margin ? above : ay + 64 + h / 2;
          const cx = Math.min(Math.max(ax, w / 2 + margin), window.innerWidth - w / 2 - margin);
          el.style.left = `${cx}px`;
          el.style.top = `${cy}px`;
          el.style.visibility = "visible";
        }
        // 「第 N 胡」跟着座位走：锚点是该家散牌区那一排的中点上方
        for (const m of marks) {
          const el = markerEls.current.get(m.seat);
          if (!el) continue;
          // 透视且角色已加载：挪到角色身侧，别压在角色身上（T2.3d）；正交照旧在牌排上方
          const p = mouseUi.project(cast.winMarkerAnchor(m.seat) ?? tableView.looseRowAnchor(m.seat), view.camera);
          const rect = view.canvas.getBoundingClientRect();
          el.style.left = `${rect.left + ((p.x + 1) / 2) * rect.width}px`;
          el.style.top = `${rect.top + ((1 - p.y) / 2) * rect.height}px`;
          el.style.visibility = "visible";
        }
      }
      cast.update(performance.now(), view.isPerspective);
      view.render();
    };
    mainLoop();

    // ---- 资源 → 场景 → envelope ----
    //
    // 全是异步的，而组件随时可能被卸载（点「返回」）。`alive` 是唯一的护栏：
    // 每个 await 之后都要看一眼，否则会往已经 dispose 掉的场景里写东西。
    let alive = true;

    (async () => {
      const assetLoader = new AssetLoader();
      await assetLoader.loadAll();
      if (!alive) return;

      objectView = new ObjectView(mainGroup, assetLoader);
      const tv = new TableView(objectView);
      tableView = tv;
      // 全局偏好为准（存档里的 display 已经不读了）
      tv.setLowercase(lowercaseRef.current);
      caseRef.current = (lower) => {
        lowercaseRef.current = lower;
        writeHandCase(lower);
        setLowercase(lower);
        tv.setLowercase(lower);
      };
      mouseUi = new MouseUi(mainGroup);

      // 拉 envelope：刷新回来时优先接管原来那局（散牌区顺序存在 localStorage 里，
      // 靠 matchId 找）。**只有 404 才清存档、开新局**，其余错误保留存档、显示出来、
      // 给「重试」——判断在 open-match.ts，那里有单测钉着。
      // 重试只重跑这一段，资源和场景不用重建。
      const loadMatch = async () => {
        setFailure(null);
        try {
          const env = await openMatch(readMatchId(), configForNewMatch(), {
            resume: api.resume,
            newMatch: api.newMatch,
            clearSave: persist.clear,
          });
          if (!alive) return;
          writeMatchId(env.matchId);
          await applyEnvelope(env);
        } catch (e) {
          if (alive) setFailure({ message: describeFailure(e), retry: () => void loadMatch() });
        }
      };
      await loadMatch();
    })().catch((e) => {
      // 走到这里的是资源加载失败（图集 / 模型）。牌局相关的错误在 loadMatch 里接住了
      if (alive) setFailure({ message: e instanceof Error ? e.message : "加载失败" });
    });

    return () => {
      alive = false;
      passRef.current = null;
      caseRef.current = null;
      actionsRef.current = null;
      chiRef.current = null;
      nextRef.current = null;
      hintRef.current = null;
      chiValidator.dispose();
      ungroupActRef.current = null;
      wildActRef.current = null;
      validator.dispose();
      window.clearTimeout(noticeTimer);
      for (const t of bubbleTimers.values()) window.clearTimeout(t);
      cancelAnimationFrame(raf);
      mount.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("mouseleave", onMouseLeave);
      mount.removeEventListener("mousedown", onMouseDown);
      mount.removeEventListener("contextmenu", onContextMenu);
      mount.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      mouseUi?.dispose();
      objectView?.dispose();
      tableGeometry.dispose();
      board.dispose();
      cast.dispose();
      tableMaterial.dispose();
      view.dispose();
    };
  }, []);

  /** 提示模式的吃牌（T6.2）：本场开了提示、是吃牌决策 → 出候选列表，不出输入框。胡牌服务端不给提示 */
  const chiHintMode = hintsOn && !claimWin && hintList.length > 0;
  /** 吃牌打出的那张怎么显示（白搭画星） */
  const chiLabel = chiTile === "1" || chiTile === "2" ? "★" : chiTile.toUpperCase();
  /** 吃牌的 [亮词] 能不能点：对应上了、校验 ✓、能亮、缩写填了全称、没有请求在途 */
  const chiReady =
    !busyUi &&
    chiFail === null &&
    chiCheck.status === "done" &&
    chiCheck.result.valid &&
    (claimWin || chiCheck.result.canReveal !== false) &&
    !(chiCheck.result.isAbbr && chiExpansion.trim() === "");

  /** 缩写还没填全称：组暗词、亮词都不能提交 */
  const needExpansion =
    check.status === "done" && !!check.result.isAbbr && expansion.trim() === "";

  return (
    <div className="table3d-page">
      <div className="table3d-stage">
        <div className="table3d-canvas" ref={mountRef} />
      </div>
      <div className="table3d-selection" ref={selectionRef} />
      <button
        className="table3d-ungroup"
        ref={ungroupBtnRef}
        disabled={busyUi}
        title={replayingUi ? "等别家出完" : undefined}
        onClick={() => ungroupActRef.current?.()}
      >
        拆开
      </button>
      {wildPicker && (
        // 双击白搭弹出的字母选择器（T4.4）：元音白搭 5 个、辅音白搭 21 个
        <div className="table3d-wild-picker" ref={wildPickerRef} role="dialog" aria-label="给白搭定字母">
          {[...WILD_CANDIDATES[wildPicker.kind]].map((c) => (
            <button
              key={c}
              className="table3d-wild-letter"
              onClick={() => wildActRef.current?.(wildPicker.tileId, c)}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {winMarks.map((m) => (
        <div
          key={m.seat}
          className="table3d-win-mark"
          ref={(el) => {
            if (el) markerEls.current.set(m.seat, el);
            else markerEls.current.delete(m.seat);
          }}
        >
          {m.label}
        </div>
      ))}
      {Object.entries(bubbles).map(([seat, b]) => (
        <div
          key={`${seat}-${b.key}`}
          className={`table3d-say${b.out ? " out" : ""}`}
          role="status"
          ref={(el) => {
            if (el) bubbleEls.current.set(Number(seat), el);
            else bubbleEls.current.delete(Number(seat));
          }}
        >
          {b.text}
        </div>
      ))}
      <ConfigBar config={config} onPeek={() => setPrefsOpen(false)} />
      {onAccount && account !== null && (
        // T6.6：和 ⚙ ⓘ 同一排。已登录显示名字，未登录 👤；点了开账号弹窗（牌局中只能注册）。
        // 登录态还没查到（account 为 null）时不出：那时点开只能进注册表单，而这人若其实已绑定，
        // 会撞上「当前身份已经绑定过账号了」——牌局中又不能改走登录。「保存成绩」也是同样处理

        <button
          className="table3d-account"
          onClick={onAccount}
          title={account?.bound ? `当前登录：${account.displayName}` : "注册账号，保存单词本和战绩"}
        >
          {account?.bound ? account.displayName : "👤"}
        </button>
      )}
      <PrefsPanel
        open={prefsOpen}
        lowercase={lowercase}
        onToggleOpen={() => setPrefsOpen((o) => !o)}
        onLowercase={(lower) => caseRef.current?.(lower)}
      />
      <button className="table3d-back" onClick={onBack}>
        ← 返回
      </button>
      {failure && (
        <div className="table3d-error" role="alert">
          <span>{failure.message}</span>
          {failure.retry && (
            <button className="table3d-retry" onClick={failure.retry}>
              重试
            </button>
          )}
        </div>
      )}
      {notice && !failure && (
        <div
          className={notice.tone === "info" ? "table3d-info" : "table3d-error"}
          role={notice.tone === "info" ? "status" : "alert"}
        >
          <span>{notice.text}</span>
        </div>
      )}
      {/* T4.2 左下角统一操作区：校验条、组暗词 / 亮词 / 取消、「过」。不压自己手牌那一排 */}
      {/* T6.5：自己胡了 / 结算中整个操作区不出（相机操作不受影响） */}
      <div className="table3d-actions" hidden={locked}>
        {check.status !== "idle" && (
          // 教学红线：只回答「是不是词」，不列候选词、不列变位词，也不读 pending.hints
          <div className="table3d-check" role="status">
            <span className="table3d-check-word">{check.display}</span>
            {check.status === "tooManyWilds" && (
              // 用户已定：两张白搭当场拦，不发请求、不弹选择器（MAX_WILDS_PER_WORD，对应 rules.py:36）
              <span className="table3d-check-bad">一个词最多只能用一张白搭</span>
            )}
            {check.status === "needWild" && (
              // 兜底：选区里恰好有一张没定字母的白搭，就地选。声明挂在 tileId 上、会存档，不是临时的；
              // 选定后推导随即变成单词，下一帧校验器自动去问服务端
              <>
                <span className="table3d-check-meta">选中的白搭还没定字母，选一个：</span>
                <div className="table3d-wild-inline">
                  {[...WILD_CANDIDATES[check.wild.kind]].map((c) => (
                    <button
                      key={c}
                      className="table3d-wild-letter"
                      onClick={() => wildActRef.current?.(check.wild.tileId, c)}
                    >
                      {c.toUpperCase()}
                    </button>
                  ))}
                </div>
              </>
            )}
            {check.status === "checking" && <span className="table3d-check-meta">校验中…</span>}
            {check.status === "done" &&
              (check.result.valid ? (
                <>
                  <span className="table3d-check-ok">✓</span>
                  <span className="table3d-check-meta">
                    {check.result.score} 分
                    {check.result.inTier && " · 词库内 +10"}
                    {(check.result.drawCount ?? 0) > 0 && ` · 亮出可补摸 ${check.result.drawCount} 张`}
                  </span>
                </>
              ) : (
                <>
                  <span className="table3d-check-bad">✗ 不是单词</span>
                  <span className="table3d-check-meta">按散牌区从左到右的顺序读</span>
                </>
              ))}
          </div>
        )}
        {check.status === "done" && check.result.valid && (
          <>
            {/* 缩写必须当场拼全称，拼得对不对由服务端判（RULES.md §8.3） */}
            {check.result.isAbbr && (
              <label className="table3d-expansion">
                <span>「{check.display}」是缩写，请拼出全称：</span>
                <input
                  value={expansion}
                  onChange={(e) => setExpansion(e.target.value)}
                  placeholder="如 television"
                  spellCheck={false}
                />
              </label>
            )}
            <div className="table3d-act-row">
              <button
                className="table3d-act-btn"
                disabled={busyUi || finished || needExpansion}
                onClick={() => actionsRef.current?.group(expansion.trim())}
              >
                组暗词
              </button>
              <button
                className={`table3d-act-btn${revealArmed ? " confirm" : ""}`}
                disabled={busyUi || !revealTurn || check.result.canReveal === false || needExpansion}
                onClick={() => actionsRef.current?.reveal(expansion.trim())}
              >
                {revealArmed ? `确认亮出 ${check.display}（不可撤回）` : "亮词"}
              </button>
              <button className="table3d-act-btn" onClick={() => actionsRef.current?.cancel()}>
                取消
              </button>
              {/* T5.2：回放期间校验照常出结果，只是提交按钮灰掉 */}
              {replayingUi && <span className="table3d-act-note">等别家出完</span>}
            </div>
            {check.result.canReveal === false && (
              <span className="table3d-act-note">亮出的词至少 3 个字母</span>
            )}
          </>
        )}
        {/* T6.2 自己回合的提示：只在「要不要亮词」决策、且本场开了提示时出现 */}
        {revealTurn && (
          <HintPanel
            enabled={hintsOn}
            hints={hintList}
            open={hintOpen}
            onToggle={() => setHintOpen((o) => !o)}
            picked={hintPicked}
            note={(h) => hintNotes[h.word] ?? null}
            onPick={(h) => hintRef.current?.pick(h)}
          />
        )}
        {/* T6.1 吃牌（输入框模式）。不读 pending.hints、不列候选：玩家自己想出词来 */}
        {chiTurn && !chiOpen && (
          <button className="table3d-act-btn" disabled={busyUi} onClick={() => chiRef.current?.open()}>
            {claimWin ? "胡" : "吃"} {chiLabel}
          </button>
        )}
        {chiTurn && chiOpen && (
          <div className="table3d-chi">
            {chiHintMode && (
              // 提示模式的吃牌：只展示服务端给的候选（pending.hints），前端不算任何候选
              <HintList
                hints={hintList}
                picked={chiInput.trim().toLowerCase() || null}
                note={(h) => hintNotes[h.word] ?? null}
                onPick={(h) => chiRef.current?.choose(h.word)}
              />
            )}
            <div className="table3d-act-row">
              {!chiHintMode && (
              <input
                className="table3d-chi-input"
                autoFocus
                value={chiInput}
                onChange={(e) => {
                  chiInputRef.current = e.target.value;
                  setChiInput(e.target.value);
                }}
                placeholder={claimWin ? `用光散牌和 ${chiLabel} 拼最后一个词` : `用打出的 ${chiLabel} 拼一个词`}
                spellCheck={false}
                autoComplete="off"
              />
              )}
              <button
                className={`table3d-act-btn${chiArmed ? " confirm" : ""}`}
                disabled={!chiReady}
                onClick={() => chiRef.current?.reveal(chiExpansion.trim())}
              >
                {chiArmed
                  ? `确认${claimWin ? "胡牌" : "亮出"} ${chiInput.trim().toUpperCase()}（不可撤回）`
                  : claimWin
                    ? "胡牌"
                    : "亮词"}
              </button>
              <button className="table3d-act-btn" onClick={() => chiRef.current?.cancel()}>
                取消
              </button>
            </div>
            <div className="table3d-chi-status">
              {chiFail === "missing" && (
                <span className="table3d-check-bad">
                  {chiHintMode ? (hintNotes[chiInput.trim().toLowerCase()]?.text ?? "要先拆开暗词") : "手里凑不出这个词"}
                </span>
              )}
              {chiFail === "tooManyWilds" && <span className="table3d-check-bad">一个词最多只能用一张白搭</span>}
              {chiFail === "discardUnused" && (
                <span className="table3d-check-bad">{claimWin ? "胡牌必须用上这张牌" : "吃牌必须用上打出的那张"}</span>
              )}
              {chiFail === "notAll" && <span className="table3d-check-bad">胡牌要用光全部散牌</span>}
              {chiFail === null && chiCheck.status === "checking" && (
                <span className="table3d-check-meta">校验中…</span>
              )}
              {chiFail === null &&
                chiCheck.status === "done" &&
                (chiCheck.result.valid ? (
                  <>
                    <span className="table3d-check-ok">✓</span>
                    <span className="table3d-check-meta">
                      {chiCheck.result.score} 分
                      {chiCheck.result.inTier && " · 词库内 +10"}
                      {(chiCheck.result.drawCount ?? 0) > 0 && ` · 亮出可补摸 ${chiCheck.result.drawCount} 张`}
                    </span>
                  </>
                ) : (
                  <span className="table3d-check-bad">✗ 不是单词</span>
                ))}
            </div>
            {chiFail === null && chiCheck.status === "done" && chiCheck.result.valid && chiCheck.result.isAbbr && (
              <label className="table3d-expansion">
                <span>「{chiCheck.display}」是缩写，请拼出全称：</span>
                <input
                  value={chiExpansion}
                  onChange={(e) => setChiExpansion(e.target.value)}
                  placeholder="如 television"
                  spellCheck={false}
                />
              </label>
            )}
            {!claimWin && chiFail === null && chiCheck.status === "done" && chiCheck.result.valid && chiCheck.result.canReveal === false && (
              <span className="table3d-act-note">亮出的词至少 3 个字母</span>
            )}
          </div>
        )}
        {passable && (
          <button className="table3d-pass" onClick={() => passRef.current?.()}>
            过
          </button>
        )}
      </div>
      {settle && (
        <Settlement
          result={settle.result}
          state={settle.state}
          matchFinished={settle.matchFinished}
          busy={busyUi}
          onNext={() => nextRef.current?.()}
          onBack={onBack}
          canSave={account !== null && !account.bound}
          onAccount={onAccount}
          onProfile={onProfile}
          onLeaderboard={onLeaderboard}
        />
      )}
      <div className="table3d-hint">
        {wallLeft === null
          ? failure
            ? ""
            : "发牌中…"
          : `${myTurn ? "轮到你出牌：拖到牌河或右键 · " : ""}空格 低头 · z / x 缩放 · p 切透视 · 拖空白处框选`}
      </div>
    </div>
  );
}
