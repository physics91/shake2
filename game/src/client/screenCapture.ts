// F12 (0x4602b3): at most once in 3 s the key asks for a capture ([0x48c2b8] via message 0x4d5),
// which the next frame writes after drawing, before the flip (0x405f4c → 0x413300): the 800 x 600
// composition ([0x493798], 0x412c00) as a 24-bit BMP, `.\ScreenCapture\MMDDhhmmss.bmp`
// (CreateFileA, CREATE_NEW). Every key is dropped while the yes/no box ([0x484698]: quit, EXIT,
// practice's) is up (0x460097); the message box does not stop it. The browser saves the file as a
// download.

/** [0x497f28]: GetTickCount of the last capture asked for. */
export const CAPTURE_INTERVAL_MS = 3000;

export function captureDue(now: number, last: number): boolean {
  return now - last >= CAPTURE_INTERVAL_MS;
}

const two = (n: number): string => String(n).padStart(2, "0");

/** 0x46b028 `%02d%02d%02d%02d%02d.bmp` of GetLocalTime's month, day, hour, minute and second. */
export function captureFileName(at: Date): string {
  return `${two(at.getMonth() + 1)}${two(at.getDate())}${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}.bmp`;
}

/**
 * The file 0x413300 writes. Its headers (0x413329-0x4133a1) put 0x15f938 in the file size, two
 * bytes more than it writes. Rows go from the bottom up, and each 5-6-5 pixel p becomes the bytes
 * p << 3, (p >> 3) & 0xf8 and p >> 8 (0x413466-0x413487): blue and five of the six green bits
 * shifted up, and for red the whole high byte, green's top three bits with it. The canvas holds
 * each field widened by bit copying, so the field is its top bits.
 */
export function captureBmp(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array<ArrayBuffer> {
  const imageSize = width * height * 3;
  const bytes = new Uint8Array(54 + imageSize);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, 0x15f938, true);
  view.setUint32(10, 0x36, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, imageSize, true);
  let out = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const p = ((rgba[i] >> 3) << 11) | ((rgba[i + 1] >> 2) << 5) | (rgba[i + 2] >> 3);
      bytes[out++] = (p << 3) & 0xff;
      bytes[out++] = (p >> 3) & 0xf8;
      bytes[out++] = p >> 8;
    }
  }
  return bytes;
}

/** [0x497f28]: when F12 was last taken. */
let lastAsked = Number.NEGATIVE_INFINITY;
interface CaptureSource { read(): HTMLCanvasElement | null }
/** The current scene supplies the program's composition surface ([0x493798]). */
let activeSource: CaptureSource | null = null;
/** [0x48c2b8]: one pending request, even if another F12 arrives before a drawing. */
let pendingCapture: { owner: CaptureSource } | null = null;
let pendingFrame: number | null = null;

/** A new program has taken no F12 yet. */
export function resetCapture(): void {
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
  pendingCapture = null;
  lastAsked = Number.NEGATIVE_INFINITY;
}

function queueCapture(): void {
  if (!pendingCapture || pendingFrame !== null) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    if (!pendingCapture || !activeSource) return;
    // 0x405f3a: an inactive window keeps its request for the next active drawing.
    if (!document.hasFocus()) return;
    if (pendingCapture.owner !== activeSource) {
      // A scene change can queue its first draw after this callback. Let it draw first.
      pendingCapture.owner = activeSource;
      queueCapture();
      return;
    }
    const canvas = activeSource.read();
    if (!canvas) {
      queueCapture();
      return;
    }
    pendingCapture = null;
    save(canvas);
  });
}

function save(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const blob = new Blob([captureBmp(data, canvas.width, canvas.height)], { type: "image/bmp" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = captureFileName(new Date());
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * F12 on a screen's canvas; `blocked` is its yes/no box, `source` what is saved: the game screens
 * save their composition, which 0x412c00 locks, not what the present made of it.
 * A source still loading or awaiting its first drawing returns null, keeping the request pending.
 * The browser's own F12 (developer tools) is kept off while a screen is up, as the key is the game's; the tools stay
 * on their menu.
 */
export function attachCapture(
  canvas: HTMLCanvasElement,
  blocked: () => boolean = () => false,
  source: () => HTMLCanvasElement | null = () => canvas,
): () => void {
  const current = { read: source };
  activeSource = current;
  queueCapture();
  const onKey = (event: KeyboardEvent) => {
    if (event.code !== "F12" || activeSource !== current) return;
    event.preventDefault();
    if (event.keyCode === 229) return;
    const now = performance.now();
    if (blocked() || !captureDue(now, lastAsked)) return;
    lastAsked = now;
    // The frame after the key, as it is drawn (the screen's own frame callback was asked for first).
    pendingCapture ??= { owner: current };
    queueCapture();
  };
  const onFocus = () => {
    if (activeSource === current) queueCapture();
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("focus", onFocus);
  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("focus", onFocus);
    if (activeSource === current) activeSource = null;
  };
}
