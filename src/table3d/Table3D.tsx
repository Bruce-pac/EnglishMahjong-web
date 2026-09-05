import { useEffect, useRef } from "react";
import * as THREE from "three";
import { WORLD_SIZE } from "./layout";

/**
 * 3D 牌桌页（骨架）。
 *
 * 这里是**裸 three.js**，不用 @react-three/fiber：React 只负责挂一个 <canvas> 和
 * 页面周边的 DOM 覆盖层，渲染循环由本组件自己用 requestAnimationFrame 驱动（D11）。
 * 组件卸载时必须把循环停掉并 dispose 掉 GPU 资源，否则来回切页会漏显存。
 *
 * 现在场景里只有一块桌面平面。牌、牌墙、相机操作分别在 T1.2 / T1.3 里加。
 */
export function Table3D({ onBack }: { onBack: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f2f22);

    // 桌面 174×174，右手系、z 向上。
    //
    // 174 不是随手取的：牌尺寸已经定死为 Size.TILE = (6, 9, 4)（需求文档 §7.1，
    // models.glb 就是按这个导出的），而 Autotable 的 World.WIDTH 正是 174——
    // 牌宽 6 / 桌宽 174 = 3.4%，与真实麻将（26mm / 900mm ≈ 2.9%）接近。
    // 桌子若给 90，同样的牌就占到 6.7%，看起来大一倍；更要命的是 T1.1 要移植的
    // setup-slots 整套格子坐标都是按 174 写的，桌子对不上就得重算 300 多行。
    //
    // 所以 1 个单位 ≈ 5.2 毫米，不是 1 厘米。
    // T1.1 已把它提成 layout.ts 的 WORLD_SIZE——Slot.rotate() 拿同一个值当旋转中心，
    // 两处对不上的话四家的槽位会绕着错误的圆心转。
    const TABLE = WORLD_SIZE;
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE, TABLE),
      new THREE.MeshLambertMaterial({ color: 0x1d6b4a }),
    );
    scene.add(table);

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(0, -40, 60);
    scene.add(key);

    // 正交相机是默认形态（D13），透视切换留给 T1.3
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    camera.position.set(0, -60, 70);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      // 保证桌面在任何窗口比例下都完整入画：短边贴合桌面，长边留白
      const half = TABLE * 0.6;
      const aspect = w / h;
      camera.left = aspect >= 1 ? -half * aspect : -half;
      camera.right = -camera.left;
      camera.top = aspect >= 1 ? half : half / aspect;
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // 自建 mainLoop：每帧一次 render，卸载时用 raf 句柄取消
    let raf = 0;
    const mainLoop = () => {
      raf = requestAnimationFrame(mainLoop);
      renderer.render(scene, camera);
    };
    mainLoop();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      table.geometry.dispose();
      (table.material as THREE.Material).dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="table3d-page">
      <div className="table3d-canvas" ref={mountRef} />
      <button className="table3d-back" onClick={onBack}>
        ← 返回
      </button>
    </div>
  );
}
