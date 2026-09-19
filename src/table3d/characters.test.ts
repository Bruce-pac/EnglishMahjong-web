/**
 * T2.3c：角色产物 `web/img/characters.glb` 与本地 Draco 解码器。
 *
 * node 环境不解码 Draco，只读 glb 的 JSON 块和图片头——够判断「产物是按配方做出来的」
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** 相对 web/ 的路径。vitest 从 web/ 起跑；tsconfig 没装 node 类型，签名见 node-shim.d.ts */
const read = (p: string): Uint8Array => readFileSync(p);
const glb = read("img/characters.glb");

interface Gltf {
  meshes: { name: string }[];
  nodes: { name?: string; mesh?: number }[];
  images: { mimeType: string; bufferView: number }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  materials: { normalTexture?: unknown; pbrMetallicRoughness?: { metallicRoughnessTexture?: unknown } }[];
  extensionsUsed?: string[];
}

/** glb = 12 字节头 + JSON 块 + BIN 块 */
function parse(buf: Uint8Array): { json: Gltf; bin: Uint8Array } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  expect(new TextDecoder().decode(buf.subarray(0, 4))).toBe("glTF");
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen))) as Gltf;
  const binStart = 20 + jsonLen;
  const binLen = dv.getUint32(binStart, true);
  return { json, bin: buf.subarray(binStart + 8, binStart + 8 + binLen) };
}

/** 从 JPEG 的 SOF 段读宽高 */
function jpegSize(img: Uint8Array): { w: number; h: number } {
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  let i = 2;
  while (i < img.length) {
    const marker = dv.getUint16(i);
    const len = dv.getUint16(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffc3) return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
    i += 2 + len;
  }
  throw new Error("JPEG 里没找到 SOF");
}

describe("characters.glb", () => {
  const { json, bin } = parse(glb);

  it("总大小 ≤ 2 MB", () => {
    expect(glb.length).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("恰好三个 mesh，节点名 seat1 / seat2 / seat3", () => {
    expect(json.meshes).toHaveLength(3);
    const named = json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name).sort();
    expect(named).toEqual(["seat1", "seat2", "seat3"]);
  });

  it("用了 Draco 压缩", () => {
    expect(json.extensionsUsed).toContain("KHR_draco_mesh_compression");
  });

  it("恰好三张图，都是 JPEG、都不超过 1024²；没有法线、金属度/粗糙度贴图", () => {
    expect(json.images).toHaveLength(3);
    for (const im of json.images) {
      expect(im.mimeType).toBe("image/jpeg");
      const view = json.bufferViews[im.bufferView];
      const data = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      expect([data[0], data[1]]).toEqual([0xff, 0xd8]); // JPEG 文件头
      const { w, h } = jpegSize(data);
      expect(Math.max(w, h)).toBeLessThanOrEqual(1024);
    }
    for (const m of json.materials) {
      expect(m.normalTexture).toBeUndefined();
      expect(m.pbrMetallicRoughness?.metallicRoughnessTexture).toBeUndefined();
    }
  });
});

describe("public/draco/ 与 node_modules/three 逐字节相同", () => {
  // three 升级后没换解码器，这里会红——见 public/draco/README.md
  for (const f of ["draco_decoder.wasm", "draco_wasm_wrapper.js"]) {
    it(f, () => {
      const mine = read(`public/draco/${f}`);
      const upstream = read(`node_modules/three/examples/jsm/libs/draco/gltf/${f}`);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.length).toBe(upstream.length);
      expect(mine.every((v, i) => v === upstream[i])).toBe(true);
    });
  }
});
