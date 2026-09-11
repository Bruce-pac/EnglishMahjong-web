import { useEffect, useRef, useState } from "react";
import { Group, Mesh, MeshLambertMaterial, PlaneGeometry, Vector2, Vector3 } from "three";
import { Size, ThingType } from "./types";
import { api, ApiError, type Envelope, type MatchConfig, type Pending } from "../api";
import { AssetLoader } from "./asset-loader";
import { SelectionValidator, type CheckState } from "./check";
import { canDiscard, canPass, type DiscardIntent } from "./discard";
import { WORLD_SIZE } from "./layout";
import { MainView } from "./main-view";
import { MouseUi } from "./mouse-ui";
import { ObjectView } from "./object-view";
import { openMatch } from "./open-match";
import * as persist from "./persist";
import { spellSelection } from "./spell";
import { TableView } from "./table-view";
import { Animation } from "./utils";

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
export function Table3D({ onBack }: { onBack: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  /** 框选的选框。DOM 覆盖层而不是 3D 对象（研究笔记 §4.3：恒定面向屏幕的 UI 一律用 DOM） */
  const selectionRef = useRef<HTMLDivElement>(null);
  /** 出错了显示什么；`retry` 有值时给一个「重试」按钮（资源加载失败时没有，重试也没用） */
  const [failure, setFailure] = useState<{ message: string; retry?: () => void } | null>(null);
  const [wallLeft, setWallLeft] = useState<number | null>(null);
  /** 等吃 / 胡的决策、且能过时显示「过」（T3.4 的最小版本，正式界面是 T6.1 / T6.3） */
  const [passable, setPassable] = useState(false);
  /** 轮到自己出牌时在提示条上说一声 */
  const [myTurn, setMyTurn] = useState(false);
  /** 服务端拒绝操作时的提示（400 的 detail），几秒后自己消失 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 「过」按钮要调 effect 闭包里的提交函数 */
  const passRef = useRef<(() => void) | null>(null);
  /** 校验条的状态。唯一的写入者是 SelectionValidator */
  const [check, setCheck] = useState<CheckState>({ status: "idle" });

  useEffect(() => {
    const mount = mountRef.current;
    const selectionEl = selectionRef.current;
    if (!mount || !selectionEl) return;

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

    const endSelection = () => {
      selectStart3 = null;
      selectDown = null;
      selectMoved = false;
      selectionEl.style.visibility = "hidden";
    };

    // 在悬停的牌上按下 → 拿起（T3.2）。拖动平面抬到那张牌的顶面（研究笔记 §4.2）。
    // 在空白处按下 → 开始框选（T3.3）
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || !tableView || !mouseUi || !hasMouse) return;
      if (tableView.hoveredThing !== null) {
        const z = tableView.dragZ;
        if (z === null) return;
        const p = mouseUi.raycastLevel(mouse2, view.camera, z);
        if (p && tableView.dragStart(p)) e.preventDefault(); // 别拖出文字选区
        return;
      }
      const p = mouseUi.raycastLevel(mouse2, view.camera, 0);
      if (!p) return;
      selectStart3 = p;
      selectDown = { x: e.clientX, y: e.clientY };
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
    };
    // 右键悬停中的散牌 = 打这张。和拖到牌河走同一个提交入口
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (!tableView || tableView.dragging || selectStart3) return;
      const hovered = tableView.hoveredThing;
      if (hovered === null) return;
      const intent = tableView.discardIntentOf(hovered);
      if (intent) submitDiscard(intent);
    };
    const onWindowMouseMove = (e: MouseEvent) => {
      if (selectDown && !selectMoved) {
        selectMoved = Math.hypot(e.clientX - selectDown.x, e.clientY - selectDown.y) > 3;
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
    let noticeTimer = 0;

    const showNotice = (message: string) => {
      setNotice(message);
      window.clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => setNotice(null), 3500);
    };

    /** 按 pending 和锁的状态刷新：牌河是不是合法落点、要不要显示「过」 */
    const refreshControls = () => {
      tableView?.setDiscardAllowed(canDiscard(pending, busy));
      setPassable(canPass(pending, busy));
      setMyTurn(canDiscard(pending, false));
    };

    /** 吃进 envelope。AI 的动作也在里面，现在直接跳到最终状态（动画是 T5.1） */
    const applyEnvelope = (env: Envelope, consumedTileIds: readonly number[] = []) => {
      tableView!.apply(env, consumedTileIds);
      matchId = env.matchId;
      pending = env.pending;
      setWallLeft(env.state.wallLeft);
      refreshControls();
    };

    /**
     * 提交一个决策。服务端 400 时显示它给的原话、局面不动（拖出去的牌早已滑回原位）。
     * 规则一律由服务端判——比如白搭能不能打，前端照常提交。
     */
    const act = async (body: Parameters<typeof api.act>[1], consumedTileIds: readonly number[] = []) => {
      if (!matchId || busy) return;
      busy = true;
      refreshControls();
      try {
        const env = await api.act(matchId, body);
        if (!alive) return;
        applyEnvelope(env, consumedTileIds);
      } catch (e) {
        if (alive) showNotice(e instanceof ApiError ? e.message : describeFailure(e));
      } finally {
        busy = false;
        if (alive) refreshControls();
      }
    };

    /** 拖到牌河、右键，都走这里。带上 tileId 给对账消歧（重复字母时空出的是打出去的那格） */
    const submitDiscard = (intent: DiscardIntent) => {
      if (!canDiscard(pending, busy)) return;
      void act({ kind: "discard", tile: intent.tile }, [intent.tileId]);
    };

    passRef.current = () => {
      if (canPass(pending, busy)) void act({ kind: "pass" });
    };

    // ---- T4.1 单词校验 ----
    // 结果只有一个来源：mainLoop 每帧喂最新的推导结果，校验器按 key 比对、变了才发请求。
    // 框选松手、单击空白清空、拖牌清空选中、envelope 剪掉离开的牌、打出一张被选中的牌——
    // 这些路径都只是改了选中集合或 LooseSlots，下一帧自然算出新 key，不在各自的回调里手动发请求。
    // 不看 pending、不受 busy 锁：校验是只读的提问
    const validator = new SelectionValidator(
      (tiles, word) =>
        matchId ? api.validate(matchId, tiles, word) : Promise.reject(new Error("牌局还没开始")),
      (state) => {
        if (alive) setCheck(state);
      },
      (e) => {
        if (alive) showNotice(e instanceof ApiError ? e.message : describeFailure(e));
      },
    );

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
        // 选中的牌描金边。objectView.selectedObjects 每次提交都会重填，交同一个数组即可
        if (objectView) view.updateOutline(objectView.selectedObjects);
      }
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
      mouseUi = new MouseUi(mainGroup);

      // 拉 envelope：刷新回来时优先接管原来那局（散牌区顺序存在 localStorage 里，
      // 靠 matchId 找）。**只有 404 才清存档、开新局**，其余错误保留存档、显示出来、
      // 给「重试」——判断在 open-match.ts，那里有单测钉着。
      // 重试只重跑这一段，资源和场景不用重建。
      const loadMatch = async () => {
        setFailure(null);
        try {
          const env = await openMatch(readMatchId(), DEFAULT_CONFIG, {
            resume: api.resume,
            newMatch: api.newMatch,
            clearSave: persist.clear,
          });
          if (!alive) return;
          writeMatchId(env.matchId);
          applyEnvelope(env);
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
      validator.dispose();
      window.clearTimeout(noticeTimer);
      cancelAnimationFrame(raf);
      mount.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("mouseleave", onMouseLeave);
      mount.removeEventListener("mousedown", onMouseDown);
      mount.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      mouseUi?.dispose();
      objectView?.dispose();
      tableGeometry.dispose();
      tableMaterial.dispose();
      view.dispose();
    };
  }, []);

  return (
    <div className="table3d-page">
      <div className="table3d-stage">
        <div className="table3d-canvas" ref={mountRef} />
      </div>
      <div className="table3d-selection" ref={selectionRef} />
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
        <div className="table3d-error" role="alert">
          <span>{notice}</span>
        </div>
      )}
      {passable && (
        <button className="table3d-pass" onClick={() => passRef.current?.()}>
          过
        </button>
      )}
      {check.status !== "idle" && (
        // 教学红线：只回答「是不是词」，不列候选词、不列变位词，也不读 pending.hints
        <div className="table3d-check" role="status">
          <span className="table3d-check-word">{check.display}</span>
          {check.status === "needWild" && (
            <span className="table3d-check-meta">选中的白搭还没定字母，暂时校验不了</span>
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
      <div className="table3d-hint">
        {wallLeft === null
          ? failure
            ? ""
            : "发牌中…"
          : `${myTurn ? "轮到你出牌：拖到牌河或右键 · " : ""}牌墙剩 ${wallLeft} 张 · 空格 低头 · z / x 缩放 · p 切透视 · 拖空白处框选`}
      </div>
    </div>
  );
}
