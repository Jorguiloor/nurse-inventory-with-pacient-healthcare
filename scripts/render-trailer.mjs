import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import ffmpegPath from "ffmpeg-static";

const FPS = 60;
const DURATION = 30;
const TOTAL_FRAMES = FPS * DURATION;
const WIDTH = 1280;
const HEIGHT = 720;

const root = process.cwd();
const htmlPath = path.join(root, "trailer", "trailer.html");
const logoPath = path.join(root, "public", "logo.png");
const outFile = path.join(root, "trailer", "medicheck-trailer.mp4");

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error("No se encontró una instalación local de Chrome o Edge. Define CHROME_PATH.");
}

const logoB64 = fs.readFileSync(logoPath).toString("base64");
const html = fs
  .readFileSync(htmlPath, "utf8")
  .replaceAll("__LOGO_DATA_URI__", `data:image/png;base64,${logoB64}`);

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 },
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});

const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);

const ff = spawn(
  ffmpegPath,
  [
    "-y",
    "-f", "image2pipe",
    "-vcodec", "png",
    "-framerate", String(FPS),
    "-i", "-",
    "-vf", `scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "17",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outFile,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);

const t0 = Date.now();
for (let f = 0; f < TOTAL_FRAMES; f++) {
  const t = f / FPS;
  await page.evaluate((sec) => window.renderFrame(sec), t);
  const buf = await page.screenshot({ type: "png", omitBackground: false });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if ((f + 1) % 120 === 0 || f + 1 === TOTAL_FRAMES) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Fotograma ${f + 1}/${TOTAL_FRAMES} (${elapsed}s)`);
  }
}

ff.stdin.end();
await new Promise((res, rej) => {
  ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg finalizó con código ${code}`))));
});
await browser.close();
console.log(`Video guardado en ${outFile}`);
