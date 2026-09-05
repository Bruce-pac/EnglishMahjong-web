import { useEffect, useRef } from "react";
import { Group, Mesh, MeshLambertMaterial, PlaneGeometry, Vector2 } from "three";
import { WORLD_SIZE } from "./layout";
import { MainView } from "./main-view";
import { Animation } from "./utils";

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

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // 世界坐标那一层。桌面和牌都挂这里，永不旋转（换座位转的是相机组）
    const mainGroup = new Group();
    mainGroup.matrixAutoUpdate = false;

    // 桌面 174×174，右手系、z 向上。
    //
    // 174 不是随手取的：牌尺寸已经定死为 Size.TILE = (6, 9, 4)（需求文档 §7.1，
    // models.glb 就是按这个导出的），牌宽 6 / 桌宽 174 = 3.4%，与真实麻将
    // （26mm / 900mm ≈ 2.9%）接近。所以 1 个单位 ≈ 5.2 毫米，不是 1 厘米。
    // 常量在 layout.ts，Slot.rotate() 拿同一个值当旋转中心——两处对不上的话
    // 四家的槽位会绕着错误的圆心转。
    const tableGeometry = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    const tableMaterial = new MeshLambertMaterial({ color: 0x1d6b4a });
    const table = new Mesh(tableGeometry, tableMaterial);
    // 槽位坐标是 0..174，桌面几何是以原点为中心的，所以要挪半个身位对上
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

    return () => {
      cancelAnimationFrame(raf);
      mount.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
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
        空格 低头 · z / x 缩放 · p 切透视
      </div>
    </div>
  );
}
