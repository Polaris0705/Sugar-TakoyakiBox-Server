// 움직이는 이미지(GIF·APNG·애니 WebP) 보존 업로드 헬퍼 — 패치 추가 파일.
// 기존 리사이즈(f)는 canvas 에 한 장만 그려 첫 프레임만 남기므로, 애니메이션이면 그 경로를 건너뛴다.
//  - GIF : 프레임을 유지한 채 gifResize 워커로 축소(실패하면 원본)
//  - APNG/WebP : 원본 그대로(브라우저 CSS background 가 그대로 재생)
//  - 정지 이미지 : 기존 리사이즈(f) 그대로
import { p as isApng, w as isAnimWebp, h as gifLoopFix, f as staticResize } from "./image-CJqz1FOB.js";

const WORKER_URL = "/assets/gifResize.worker-BPC6SMn_.js";
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL(WORKER_URL, import.meta.url), { type: "module" });
    worker.onmessage = (ev) => {
      const { id, ok, buffer } = ev.data || {};
      const cb = pending.get(id);
      if (cb) { pending.delete(id); cb({ ok, buffer }); }
    };
    worker.onerror = () => {
      for (const cb of pending.values()) cb({ ok: false });
      pending.clear();
      try { worker && worker.terminate(); } catch {}
      worker = null;
    };
  } catch { worker = null; }
  return worker;
}

function resizeGif(bytes, maxDim) {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return Promise.resolve(bytes);
  const w = getWorker();
  if (!w) return Promise.resolve(bytes);
  const copy = bytes.slice().buffer;
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve(bytes); }, 25000);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r.ok && r.buffer && r.buffer.byteLength > 0 && r.buffer.byteLength < bytes.byteLength ? new Uint8Array(r.buffer) : bytes);
    });
    try { w.postMessage({ id, buffer: copy, maxDim }, [copy]); }
    catch { clearTimeout(timer); pending.delete(id); resolve(bytes); }
  });
}

function toBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768));
  return btoa(s);
}

function kindOf(u8) {
  if (u8.length >= 6 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return "gif";
  if (u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return "png";
  if (u8.length >= 16 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
      u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return "webp";
  return "";
}

/** 표시 크기(preset)에 필요한 만큼만 GIF 긴 변을 줄인다. cover 면 짧은 변이 목표를 채우도록. */
function gifTargetDim(u8, preset) {
  const w = u8[6] | (u8[7] << 8), h = u8[8] | (u8[9] << 8);
  if (!w || !h) return 0;
  const { maxW, maxH, cover } = preset;
  const s = cover ? Math.min(1, Math.max(maxW / w, maxH / h)) : Math.min(1, maxW / w, maxH / h);
  return s < 1 ? Math.max(1, Math.round(Math.max(w, h) * s)) : 0;
}

/**
 * file → data URL. 애니메이션이면 움직임을 보존하고, maxChars(서버 저장 상한)를 넘으면 알기 쉬운 오류를 낸다.
 * (서버는 상한을 넘는 data URL 을 잘라 저장해 이미지가 깨지므로, 넘으면 반드시 여기서 막는다.)
 */
export async function animAware(file, preset, maxChars) {
  if (!file || !file.type || !file.type.startsWith("image/")) throw new Error("이미지 파일이 아닙니다");
  const u8 = new Uint8Array(await file.arrayBuffer());
  const kind = kindOf(u8);
  const animated = kind === "gif" || (kind === "png" && isApng(u8)) || (kind === "webp" && isAnimWebp(u8));
  if (!animated) return staticResize(file, preset);

  let url;
  if (kind === "gif") {
    const dim = gifTargetDim(u8, preset);
    const out = dim ? await resizeGif(u8, dim) : u8;
    url = "data:image/gif;base64," + toBase64(gifLoopFix(out));
  } else {
    url = "data:image/" + kind + ";base64," + toBase64(u8);
  }
  if (maxChars && url.length > maxChars) {
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    throw new Error(`움직이는 이미지가 너무 큽니다(약 ${mb(url.length * 0.75)}MB). 약 ${mb(maxChars * 0.75)}MB 이하로 줄여 주세요.`);
  }
  return url;
}
