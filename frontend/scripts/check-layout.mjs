// Checks that every screen of the kiosk fits the window, without page scrollbars: at 1920x1080 and
// at 1536x864 (Windows at 125%), with normal and maximum text size, in Italian and in Arabic.
// The overflow: clip of html and body is turned off first, so that what it would hide counts.
// The print dialog is opened on a blank form given to it directly, so it never prints and needs
// no backend; its card must show everything without scrolling inside. The same for the
// accessibility panel and the dialog that ends the conversation. The form opened in the chat comes
// from the backend: without it the viewer shows its error, which must fit as well.
//
// Uso (con "npm start" acceso):   node scripts/check-layout.mjs [http://localhost:4200/]
// Chrome si trova da solo; altrimenti CHROME=percorso\chrome.exe. Esce con 1 se una schermata scorre.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:4200/';
const chrome = [
  process.env.CHROME,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  '/usr/bin/google-chrome'
].find((path) => path && existsSync(path));
if (!chrome) {
  console.error('Chrome non trovato: indicalo con CHROME=...');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = mkdtempSync(join(tmpdir(), 'totem-layout-'));
const port = 9400 + Math.floor(Math.random() * 400);
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 60 && !targets.length; i++) {
  await sleep(250);
  try {
    targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page');
  } catch {
    // Chrome is still starting.
  }
}
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
const send = (method, params = {}) => new Promise((resolve) => {
  pending.set(++id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const run = async (expression) => {
  const message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (message.result?.exceptionDetails) throw new Error(message.result.exceptionDetails.exception?.description);
  return message.result?.result?.value;
};

// The page, or the document of the office finder's frame, as if nothing were clipped.
const fits = (frame = false) => run(`(() => {
  const doc = ${frame ? "document.querySelector('iframe.webapp')?.contentDocument" : 'document'};
  if (!doc) return 'no frame';
  if (!doc.getElementById('unclip')) {
    const style = doc.createElement('style');
    style.id = 'unclip';
    style.textContent = 'html, body { overflow: visible !important; }';
    doc.head.append(style);
  }
  const d = doc.documentElement;
  const view = ${frame ? 'doc.defaultView' : 'window'};
  // The office finder is a long page: it scrolls down by design, never sideways.
  const ok = d.scrollWidth <= view.innerWidth && (${frame} || d.scrollHeight <= view.innerHeight);
  return ok ? 'ok' : 'SCROLL ' + d.scrollWidth + 'x' + d.scrollHeight + ' in ' + view.innerWidth + 'x' + view.innerHeight;
})()`);
// A card over the screen (a dialog, a panel), showing what it should: inside the window, and with
// nothing hidden below its scroll.
const cardFits = ([selector, inside]) => run(`(() => {
  const card = document.querySelector(${JSON.stringify(selector)});
  if (!card?.querySelector(${JSON.stringify(inside)})) return 'no ' + ${JSON.stringify(inside)};
  const box = card.getBoundingClientRect();
  const ok = box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth &&
    card.scrollHeight <= card.clientHeight;
  return ok ? 'ok' : 'CARD ' + Math.round(box.top) + '-' + Math.round(box.bottom) + ', ' + card.scrollHeight + ' in ' + card.clientHeight;
})()`);
const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)})?.click()`);
const app = "ng.getComponent(document.querySelector('app-root'))";
const printer = "ng.getComponent(document.querySelector('app-summary-panel')).printer";
const chat = "ng.getComponent(document.querySelector('app-chatbot'))";

let failures = 0;
try {
  await send('Runtime.enable');
  for (const [width, height] of [[1920, 1080], [1536, 864]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const fs of [100, 200]) {
      for (const [index, lang] of [[0, 'it'], [5, 'ar']]) {
        await send('Page.navigate', { url });
        await sleep(3500);
        await run(`${app}.a11y.set('fs', ${fs})`);
        const results = [];
        const check = async (screen, { frame = false, card = null } = {}) => {
          await sleep(900);
          let result = await fits(frame);
          if (result === 'ok' && card) result = await cardFits(card);
          results.push(`${screen} ${result}`);
          if (result !== 'ok') failures++;
        };
        await check('benvenuto');
        await click('.lang-switch');
        await check('lingua');
        await run(`document.querySelectorAll('.language-card')[${index}].click()`);
        await sleep(800);
        await click('.welcome');
        await check('scelta');
        await click('.choice-assistant');
        await check('chat');
        // A form of two A4 pages, as if printed from its viewer, then its first page full size.
        await run(`(() => {
          const canvas = document.createElement('canvas');
          canvas.width = 1240;
          canvas.height = 1754;
          const page = canvas.toDataURL();
          ${printer}.ask({ title: 'Modulo di richiesta', pages: [page, page] });
        })()`);
        await check('stampa', { card: ['.pd-card', 'app-print-docs .doc'] });
        await click('app-print-docs .view');
        await check('anteprima', { card: ['.pd-card', 'app-print-preview .sheet'] });
        await run(`${printer}.cancel()`);
        await click('app-accessibility .a11y-btn');
        await check('accessibilità', { card: ['.a11y-panel', '.a11y-head'] });
        await click('app-accessibility .a11y-btn');
        await click('#chat-input');
        await check('tastiera');
        await run(`${chat}.closeKeyboard()`);
        // A conversation about two subjects, with the summary beside it.
        await run(`(() => {
          const state = ${app}.state;
          const form = { id: 'f', title: 'Modulo di richiesta', url: 'http://localhost:8000/files/modulo-richiesta-cie.pdf', topic: 'cie' };
          state.addMessage({ text: 'Domanda sulla carta', sender: 'user' });
          state.addMessage({ text: 'Risposta lunga. '.repeat(40), sender: 'bot', topic: 'cie', forms: [form], bring: ['Foto', 'Documento'] });
          state.addMessage({ text: 'Domanda sulla residenza', sender: 'user' });
          state.addMessage({ text: 'Altra risposta. '.repeat(40), sender: 'bot', topic: 'residenza', bring: ['Modulo'] });
        })()`);
        await check('chat con riepilogo');
        await run(`${chat}.viewer.open({ url: 'http://localhost:8000/files/modulo-richiesta-cie.pdf', title: 'Modulo di richiesta', kind: 'modulo' })`);
        await sleep(2500);
        await check('modulo aperto');
        await click('#chat-input');
        await check('modulo e tastiera');
        await run(`${chat}.closeKeyboard()`);
        await run(`${chat}.viewer.close()`);
        await click('.end-btn');
        await check('termina', { card: ['.ed-card', '.ed-primary'] });
        await click('.ed-secondary');
        await click('.back-btn');
        await sleep(600);
        await click('.choice-offices');
        await sleep(2500);
        await check('uffici', { frame: true });
        console.log(`${width}x${height} testo ${fs}% ${lang}: ${results.join(' | ')}`);
      }
    }
  }
} finally {
  ws.close();
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}

console.log(failures ? `${failures} schermate con le barre di scorrimento` : 'Tutte le schermate entrano nella finestra.');
process.exit(failures ? 1 : 0);
