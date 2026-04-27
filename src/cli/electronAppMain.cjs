/**
 * Minimal Electron entry: loads the Winnow UI URL in a dedicated app window.
 * Invoked as: npx electron@<pin> <this-file> <http://127.0.0.1:...>
 */
const { app, BrowserWindow } = require("electron");

const loadUrl = process.argv.slice(2).find((a) => /^https?:\/\//i.test(a));
if (!loadUrl) {
  process.stderr.write("winnow-electron: missing http(s) URL argument\n");
  process.exit(1);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: "Winnow",
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  win.loadURL(loadUrl);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
