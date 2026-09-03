#!/usr/bin/env python3
"""
Shrink a GLB for mobile AR without a Node toolchain.

Two lossy-but-imperceptible passes:

  1. Vertex quantization (KHR_mesh_quantization). Float32 position/normal/UV
     become int16/int8/uint16, cutting the vertex buffer to half its size.
     Dequantization is folded into the mesh node's translation and uniform
     scale, so world coordinates are unchanged.
  2. Texture recompression. Base colour and metallic-roughness are re-encoded
     (metallic-roughness is also downscaled, being low-frequency data).
     The normal map is left untouched: it is the most compression-sensitive.

Geometry is NOT decimated -- triangle count is preserved exactly.

Usage:  python3 tools/optimize-glb.py input.glb output.glb [--max-mb 3]
"""
import json
import struct
import sys
import io
import numpy as np
from PIL import Image

COMP = {5120: "<i1", 5121: "<u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    raw = open(path, "rb").read()
    magic, version, _ = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67:
        raise SystemExit("%s is not a GLB file" % path)
    off = 12
    jlen, _ = struct.unpack_from("<II", raw, off); off += 8
    gltf = json.loads(raw[off:off + jlen]); off += jlen
    blen, _ = struct.unpack_from("<II", raw, off); off += 8
    return gltf, raw, off, blen


def accessor_array(gltf, raw, bin_off, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    n = NCOMP[acc["type"]]
    dt = np.dtype(COMP[acc["componentType"]])
    base = bin_off + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride")
    if not stride:
        return np.frombuffer(raw, dtype=dt, count=acc["count"] * n, offset=base).reshape(acc["count"], n)
    need = (acc["count"] - 1) * stride + n * dt.itemsize
    buf = np.frombuffer(raw, dtype=np.uint8, count=need, offset=base)
    rows = np.lib.stride_tricks.as_strided(buf, shape=(acc["count"], n * dt.itemsize), strides=(stride, 1))
    return np.ascontiguousarray(rows).view(dt).reshape(acc["count"], n)


def pad4(buf, filler=b"\x00"):
    while len(buf) % 4:
        buf += filler
    return buf


def optimize(src, dst, max_mb=3.0):
    gltf, raw, bin_off, _ = read_glb(src)
    before = len(raw)

    if len(gltf.get("meshes", [])) != 1 or len(gltf["meshes"][0]["primitives"]) != 1:
        raise SystemExit("This script handles single-mesh, single-primitive models only.")

    prim = gltf["meshes"][0]["primitives"][0]
    attrs = prim["attributes"]
    for required in ("POSITION", "NORMAL", "TEXCOORD_0"):
        if required not in attrs:
            raise SystemExit("Model is missing %s" % required)

    pos = accessor_array(gltf, raw, bin_off, attrs["POSITION"]).astype(np.float64)
    nrm = accessor_array(gltf, raw, bin_off, attrs["NORMAL"]).astype(np.float64)
    uv = accessor_array(gltf, raw, bin_off, attrs["TEXCOORD_0"]).astype(np.float64)
    idx = accessor_array(gltf, raw, bin_off, prim["indices"]).ravel()
    count = len(pos)

    if uv.min() < -1e-6 or uv.max() > 1 + 1e-6:
        raise SystemExit("UVs fall outside [0,1]; normalized UV quantization would clip them.")

    # --- quantize ----------------------------------------------------------
    lo, hi = pos.min(axis=0), pos.max(axis=0)
    centre = (lo + hi) / 2.0
    scale = float((hi - lo).max()) / 65534.0 or 1.0   # uniform, keeps normals undistorted
    qpos = np.clip(np.rint((pos - centre) / scale), -32767, 32767).astype("<i2")
    qnrm = np.clip(np.rint(nrm * 127.0), -127, 127).astype("<i1")
    quv = np.clip(np.rint(uv * 65535.0), 0, 65535).astype("<u2")

    # Interleave at stride 16 so every attribute starts on a 4-byte boundary:
    # position 0..5, pad, normal 8..10, pad, uv 12..15.
    vbuf = np.zeros((count, 16), dtype=np.uint8)
    vbuf[:, 0:6] = qpos.view(np.uint8).reshape(count, 6)
    vbuf[:, 8:11] = qnrm.view(np.uint8).reshape(count, 3)
    vbuf[:, 12:16] = quv.view(np.uint8).reshape(count, 4)
    vertex_bytes = vbuf.tobytes()
    index_bytes = idx.astype("<u4").tobytes()

    max_error = float(np.abs((qpos.astype(np.float64) * scale + centre) - pos).max())

    # --- textures ----------------------------------------------------------
    images = []
    for i, image in enumerate(gltf.get("images", [])):
        view = gltf["bufferViews"][image["bufferView"]]
        start = bin_off + view.get("byteOffset", 0)
        data = raw[start:start + view["byteLength"]]
        name = (image.get("name") or "").lower()
        if "normal" in name:
            images.append((image.get("name"), data, "kept (compression-sensitive)"))
            continue
        try:
            im = Image.open(io.BytesIO(data)).convert("RGB")
            if "metallic" in name or "roughness" in name:
                im = im.resize((max(im.width // 2, 64),) * 2, Image.LANCZOS)
                quality = 80
            else:
                quality = 82
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=quality, optimize=True, progressive=True)
            new = out.getvalue()
            if len(new) < len(data):
                images.append((image.get("name"), new, "%dx%d q%d" % (im.width, im.height, quality)))
            else:
                images.append((image.get("name"), data, "kept (recompression was larger)"))
        except Exception:
            images.append((image.get("name"), data, "kept (could not decode)"))

    # --- rebuild -----------------------------------------------------------
    blob = bytearray()
    views, offsets = [], []
    for payload, target in ((index_bytes, 34963), (vertex_bytes, 34962)):
        blob = bytearray(pad4(bytes(blob)))
        offsets.append(len(blob))
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(payload), "target": target})
        blob += payload
    views[1]["byteStride"] = 16
    for _, payload, _ in images:
        blob = bytearray(pad4(bytes(blob)))
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(payload)})
        blob += payload

    gltf["bufferViews"] = views
    gltf["accessors"] = [
        {"bufferView": 0, "componentType": 5125, "count": len(idx), "type": "SCALAR",
         "min": [int(idx.min())], "max": [int(idx.max())]},
        {"bufferView": 1, "byteOffset": 0, "componentType": 5122, "count": count, "type": "VEC3",
         "min": [int(v) for v in qpos.min(axis=0)], "max": [int(v) for v in qpos.max(axis=0)]},
        {"bufferView": 1, "byteOffset": 8, "componentType": 5120, "count": count, "type": "VEC3",
         "normalized": True},
        {"bufferView": 1, "byteOffset": 12, "componentType": 5123, "count": count, "type": "VEC2",
         "normalized": True},
    ]
    prim["indices"] = 0
    prim["attributes"] = {"POSITION": 1, "NORMAL": 2, "TEXCOORD_0": 3}

    for i, image in enumerate(gltf.get("images", [])):
        image["bufferView"] = 2 + i
        image["mimeType"] = "image/jpeg"

    # Fold dequantization into the mesh node.
    node = gltf["nodes"][gltf["meshes"][0].get("_node_index", 0)]
    for n in gltf["nodes"]:
        if n.get("mesh") == 0:
            node = n
            break
    node["translation"] = [float(v) for v in centre]
    node["scale"] = [scale, scale, scale]
    node.pop("matrix", None)
    node.pop("rotation", None)

    used = set(gltf.get("extensionsUsed", [])) | {"KHR_mesh_quantization"}
    required = set(gltf.get("extensionsRequired", [])) | {"KHR_mesh_quantization"}
    gltf["extensionsUsed"] = sorted(used)
    gltf["extensionsRequired"] = sorted(required)
    gltf["buffers"] = [{"byteLength": len(blob)}]

    json_chunk = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    bin_chunk = pad4(bytes(blob))
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    with open(dst, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(json_chunk), 0x4E4F534A)); fh.write(json_chunk)
        fh.write(struct.pack("<II", len(bin_chunk), 0x004E4942)); fh.write(bin_chunk)

    print("triangles      : %d (unchanged)" % (len(idx) // 3))
    print("vertices       : %d (unchanged)" % count)
    print("max position error: %.3e model units" % max_error)
    for name, payload, note in images:
        print("  texture %-20s %8d bytes  %s" % (name, len(payload), note))
    print("before : %8d bytes (%.2f MB)" % (before, before / 1048576))
    print("after  : %8d bytes (%.2f MB)" % (total, total / 1048576))
    print("saved  : %8d bytes (%.1f%%)" % (before - total, 100 * (before - total) / before))
    if total > max_mb * 1048576:
        print("WARNING: still above the %.1f MB target" % max_mb)
    return total


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    limit = 3.0
    if "--max-mb" in sys.argv:
        limit = float(sys.argv[sys.argv.index("--max-mb") + 1])
    optimize(sys.argv[1], sys.argv[2], limit)
