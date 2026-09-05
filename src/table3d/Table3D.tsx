import { useEffect, useRef } from "react";
import * as THREE from "three";

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

    // 桌面：1 个单位 = 1 厘米，桌面按真牌桌大小给 90×90，牌面朝 +z（右手系，z 向上）
    const TABLE = 90;
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
