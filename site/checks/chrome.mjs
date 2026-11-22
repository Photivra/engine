// SPDX-License-Identifier: Apache-2.0
// A small headless Chromium driver over the Chrome DevTools Protocol, with Node's built-in WebSocket and no npm package
// (the technique of test/webgpu/chromium.ts). Used by the browser pass, the Lighthouse run and the image tool.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/** SITE_CHROME, then Playwright's Chromium, then common system locations. */
export function findChrome() {
  const explicit = process.env.SITE_CHROME ?? process.env.CHROME_PATH;
  if (explicit) return existsSync(explicit) ? explicit : null;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(home, ".cache/ms-playwright"), join(home, "Library/Caches/ms-playwright")].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((name) => /^chromium-\d+$/u.test(name)).sort().reverse()) {
      for (const candidate of [join(root, entry, "chrome-linux", "chrome"), join(root, entry, "chrome-linux64", "chrome"),
        join(root, entry, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        join(root, entry, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
        join(root, entry, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        join(root, entry, "chrome-win", "chrome.exe")]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Starts headless Chromium with remote debugging on a free port.
 * @returns {Promise<{ port: number, close: () => Promise<void>, connect: () => Promise<Session> }>}
 */
export async function launchChrome(extraFlags = []) {
  const executable = findChrome();
  if (!executable) throw new Error("No Chromium found: install one (npx --no-install playwright-core install chromium after the root npm ci) or set SITE_CHROME");
  const profile = mkdtempSync(join(tmpdir(), "site-chrome-"));
  const child = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--disable-features=Translate,OptimizationHints,MediaRouter", "--metrics-recording-only", "--mute-audio", "--hide-scrollbars",
    ...(process.platform === "linux" ? ["--no-sandbox"] : []), ...extraFlags, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const port = await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error(`Chromium did not start: ${text}`)), 30_000);
    child.stderr.on("data", (chunk) => {
      text += chunk;
      const found = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//u);
      if (found) {
        clearTimeout(timer);
        resolve(Number(found[1]));
      }
    });
    child.on("exit", (code) => reject(new Error(`Chromium exited (${code}): ${text}`)));
  });
  return {
    port,
    async connect() {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === "page");
      return Session.open(page.webSocketDebuggerUrl);
    },
    async close() {
      child.kill();
      await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
      rmSync(profile, { recursive: true, force: true });
    }
  };
}

/** One DevTools protocol connection to a page. */
export class Session {
  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new Session(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} ${message.error.data ?? ""}`));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
      }
    });
  }

  send(method, params = {}) {
    const id = this.next++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  once(method, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const listener = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) ?? []).filter((item) => item !== listener));
        resolve(params);
      };
      this.on(method, listener);
    });
  }

  /** Evaluates an expression in the page, awaiting a promise; returns its JSON value. */
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`Page error: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  }

  /** Navigates and waits for the load event. */
  async navigate(url) {
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
  }

  close() {
    this.socket.close();
  }
}
