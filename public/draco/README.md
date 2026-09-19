# Draco 解码器（本地副本）

`characters.glb`（三个 AI 角色，T2.3c）用 Draco 压缩了几何，加载时要这两个文件解码：

| 文件 | 来源 |
|---|---|
| `draco_decoder.wasm` | `node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm` |
| `draco_wasm_wrapper.js` | `node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js` |

- **版本**：随 three **0.185.1** 附带的那一份，逐字节拷贝。
- **许可**：Draco 是 Google 的开源项目，Apache License 2.0（https://github.com/google/draco）。
- **为什么放在这里而不是走 CDN**：运行时零外部依赖（课堂网络不可靠）。`DRACOLoader` 的默认路径是
  Google 的 CDN，`character-loader.ts` 显式把它设成了本站 `/draco/`。
- **为什么不走 Vite 的 `?url`**：`DRACOLoader` 要的是**目录**，文件名它自己拼；`?url` 会加哈希，拼不上。
  `public/` 下的文件原样拷进 `dist/`，不改名。

## ⚠️ three 升级时要一起换

解码器和 three 的 `DRACOLoader` 是配套的。升级 three 之后重新拷一遍：

```bash
cp node_modules/three/examples/jsm/libs/draco/gltf/draco_{decoder.wasm,wasm_wrapper.js} public/draco/
```

`src/table3d/characters.test.ts` 会逐字节比对这两个文件和 `node_modules/three` 里的——忘了换，那条测试会红。
