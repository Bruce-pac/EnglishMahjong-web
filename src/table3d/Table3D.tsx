import { useEffect, useRef, useState } from "react";
import { Group, Mesh, MeshLambertMaterial, PlaneGeometry, Vector2 } from "three";
import { Size, ThingType } from "./types";
import { api, type Envelope, type MatchConfig } from "../api";
import { AssetLoader } from "./asset-loader";
import { WORLD_SIZE } from "./layout";
import { MainView } from "./main-view";
import { ObjectView } from "./object-view";
import * as persist from "./persist";
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
 * 3D 牌桌页。
 *
 * 这里是**裸 three.js**，不用 @react-three/fiber：React 只负责挂一个容器 div 和
 * 页面周边的 DOM 覆盖层，渲染循环由本组件自己用 requestAnimationFrame 驱动（D11）。
 * 组件卸载时必须把循环停掉并 dispose 掉 GPU 资源，否则来回切页会漏显存。
 *
 * 本组件只做三件事：建场景、收键鼠、每帧推进相机动画并渲染。
 * 场景/相机/灯光/后处理都在 `main-view.ts`；牌是 T1.2；拾取与拖放是 T3.x。
 */
export function Table3D({ onBack }: { onBack: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [wallLeft, setWallLeft] = useState<number | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

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
    /** 鼠标在画面里的归一化坐标（-1..1）。放大时相机跟着它平移 */
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
      keys.clear();
      lookDown.start(0);
      zoom.start(0);
    };

    mount.addEventListener("mousemove", onMouseMove);
    mount.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    // 自建 mainLoop：每帧推进动画、对齐画布、摆相机、渲染
    let raf = 0;
    const mainLoop = () => {
      raf = requestAnimationFrame(mainLoop);
      lookDown.update();
      zoom.update();
      view.updateViewport();
      // 单人对局座位恒为 0（需求文档 §1：1 真人 + 3 AI）
      view.updateCamera(0, lookDown.pos, zoom.pos, hasMouse ? mouse2 : null);
      view.render();
    };
    mainLoop();

    // ---- 资源 → 场景 → envelope ----
    //
    // 全是异步的，而组件随时可能被卸载（点「返回」）。`alive` 是唯一的护栏：
    // 每个 await 之后都要看一眼，否则会往已经 dispose 掉的场景里写东西。
    let alive = true;
    let objectView: ObjectView | null = null;

    (async () => {
      const assetLoader = new AssetLoader();
      await assetLoader.loadAll();
      if (!alive) return;

      objectView = new ObjectView(mainGroup, assetLoader);
      const tableView = new TableView(objectView);

      // 刷新回来时优先接管原来那局（散牌区顺序存在 localStorage 里，靠 matchId 找）
      const saved = readMatchId();
      let env: Envelope;
      if (saved) {
        try {
          env = await api.resume(saved);
        } catch {
          // 牌局只存内存，服务器重启就没了（DESIGN.md §3 的有意取舍）。
          // 存档跟着清掉，然后当作新局开一把
          persist.clear(saved);
          if (!alive) return;
          env = await api.newMatch(DEFAULT_CONFIG);
        }
      } else {
        env = await api.newMatch(DEFAULT_CONFIG);
      }
      if (!alive) return;

      writeMatchId(env.matchId);
      tableView.apply(env);
      setWallLeft(env.state.wallLeft);
    })().catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : "开局失败");
    });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      mount.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
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
      <button className="table3d-back" onClick={onBack}>
        ← 返回
      </button>
      <div className="table3d-hint">
        {error ?? (wallLeft === null ? "发牌中…" : `牌墙剩 ${wallLeft} 张 · 空格 低头 · z / x 缩放 · p 切透视`)}
      </div>
    </div>
  );
}
