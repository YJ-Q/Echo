import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

app.disableHardwareAcceleration();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const outputDir = path.join(root, "case-study/dist");

function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
        milliseconds
      );
    })
  ]).finally(() => clearTimeout(timer));
}

async function render(lang) {
  const input = path.join(root, `case-study/pdf/margin-case-study.${lang}.html`);
  const output = path.join(outputDir, `margin-case-study.${lang}.pdf`);
  let window;
  try {
    window = new BrowserWindow({
      width: 1400,
      height: 990,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    await withTimeout(
      window.loadURL(pathToFileURL(input).href),
      8_000,
      `${lang} PDF HTML load`
    );
    await withTimeout(
      window.webContents.executeJavaScript("document.fonts.ready.then(() => true)"),
      4_000,
      `${lang} font readiness`
    );
    const pdf = await withTimeout(
      window.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      }),
      15_000,
      `${lang} PDF print`
    );
    await fs.writeFile(output, pdf);
    console.log(`Rendered ${path.relative(root, output)} (${pdf.length} bytes)`);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
  }
}

app.whenReady()
  .then(async () => {
    await fs.mkdir(outputDir, { recursive: true });
    await render("zh");
    await render("en");
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
