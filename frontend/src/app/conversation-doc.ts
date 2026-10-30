// The printed summary of a conversation, for the citizen to bring to the counter: a table with
// the citizen's language on the left and the Italian translation on the right, one row per
// message. The pages are drawn by the browser, which writes Arabic, Bengali and Chinese
// correctly, and printed as images like the forms.

/** A sheet of A4 paper at 150 dpi: the printer scales it to its own resolution. */
const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = 70;
const GAP = 14;
const PAD = 16;
const BODY = 26;
const LINE = Math.round(BODY * 1.42);
const LABEL = 22;
const TITLE = 42;
const TITLE_LINE = 60;
// The subject of the sheet, under the titles.
const TOPIC = 32;
const TOPIC_LINE = 46;
const FONTS = '"Segoe UI", "Nirmala UI", "Microsoft YaHei", "Noto Sans", "Noto Sans Bengali", "Noto Sans Arabic", "Noto Sans CJK SC", Arial, sans-serif';
const RTL = ['ar'];

// Source numbers such as [1] or [١]: they refer to links that are not on paper.
const CITATION = /\s*[\[【［]\s*\d+(?:\s*[,،，、;]\s*\d+)*\s*[\]】］]/g;

export interface DocRow {
  /** Who wrote the message; "bring": the list of things to bring, before the conversation. */
  sender: 'user' | 'bot' | 'bring';
  original: string;
  italian: string;
}

export interface DocLabels {
  /** "Bring this sheet to the counter", in Italian and in the citizen's language. */
  titleIt: string;
  titleOwn: string;
  /** The subject of the sheet ("Argomento: Carta d'identità"); none for a whole conversation. */
  topicIt?: string;
  topicOwn?: string;
  /** Over the list of things to bring. */
  bringIt: string;
  bringOwn: string;
  /** Header of each column. */
  languageOwn: string;
  languageIt: string;
  /** Who wrote each message, in each language. */
  citizenOwn: string;
  citizenIt: string;
  assistantOwn: string;
  assistantIt: string;
  /** Lines in Italian for the clerk: when, which language, that it is an automatic translation. */
  details: string[];
  page: string;
}

export function cleanText(text: string): string {
  return text.replace(CITATION, '').replace(/[ \t]+\n/g, '\n').trim();
}

interface Cell {
  label: string;
  lines: string[];
  rtl: boolean;
  lang: string;
}

interface Slice {
  left: Cell;
  /** The Italian translation; none on the sheet of an Italian conversation, which has one column. */
  right: Cell | null;
  from: number;
  to: number;
  first: boolean;
}

/** The pages of the summary as PNG data URLs. */
export function renderConversation(lang: string, rows: DocRow[], labels: DocLabels): string[] {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d')!;

  const translated = lang !== 'it';
  const colW = (PAGE_W - 2 * MARGIN) / (translated ? 2 : 1);
  const textW = colW - 2 * PAD;
  const rtl = RTL.includes(lang);
  const label = (row: DocRow, own: boolean) =>
    row.sender === 'bring'
      ? (own ? labels.bringOwn : labels.bringIt)
      : row.sender === 'user'
        ? (own ? labels.citizenOwn : labels.citizenIt)
        : (own ? labels.assistantOwn : labels.assistantIt);

  const cells = rows.map((row) => {
    ctx.font = `${BODY}px ${FONTS}`;
    const left: Cell = { label: label(row, true), lines: wrap(ctx, cleanText(row.original), textW, lang), rtl, lang };
    const right: Cell | null = translated
      ? { label: label(row, false), lines: wrap(ctx, cleanText(row.italian), textW, 'it'), rtl: false, lang: 'it' }
      : null;
    return { left, right };
  });

  // First pass: which lines of which row go on which page.
  const headH = headerHeight(ctx, labels, PAGE_W - 2 * MARGIN);
  const colHeadH = LINE + 2 * PAD;
  const labelH = LABEL + 12;
  const footH = 50;
  const pages: Slice[][] = [];
  let page: Slice[] = [];
  let y = 0;
  const top = (n: number) => (n === 0 ? MARGIN + headH : MARGIN) + colHeadH;
  const bottom = PAGE_H - MARGIN - footH;
  y = top(0);

  for (const { left, right } of cells) {
    const total = Math.max(left.lines.length, right?.lines.length ?? 0);
    let from = 0;
    while (from < total || (total === 0 && from === 0)) {
      const first = from === 0;
      const room = Math.floor((bottom - y - 2 * PAD - (first ? labelH : 0)) / LINE);
      // Not even a few lines of the row fit: it starts on the next page.
      if (page.length > 0 && (room < Math.min(3, total - from) || room < 1)) {
        pages.push(page);
        page = [];
        y = top(pages.length);
        continue;
      }
      const to = Math.min(total, from + Math.max(1, room));
      page.push({ left, right, from, to, first });
      y += 2 * PAD + (first ? labelH : 0) + (to - from) * LINE;
      from = to;
      if (total === 0) break;
    }
  }
  pages.push(page);

  // Second pass: draw.
  return pages.map((slices, n) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';
    ctx.textBaseline = 'top';

    let y = MARGIN;
    if (n === 0) y = drawHeader(ctx, labels, lang, y);

    // Column headings, on every page.
    ctx.lineWidth = 3;
    ctx.fillStyle = '#000000';
    ctx.fillRect(MARGIN, y, PAGE_W - 2 * MARGIN, colHeadH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${BODY}px ${FONTS}`;
    drawText(ctx, labels.languageOwn, MARGIN + PAD, y + PAD, textW, rtl, lang);
    if (translated) drawText(ctx, labels.languageIt, MARGIN + colW + PAD, y + PAD, textW, false, 'it');
    ctx.fillStyle = '#000000';
    y += colHeadH;

    for (const slice of slices) {
      const lines = slice.to - slice.from;
      const h = 2 * PAD + (slice.first ? labelH : 0) + lines * LINE;
      ctx.lineWidth = 2;
      ctx.strokeRect(MARGIN, y, colW, h);
      if (slice.right) ctx.strokeRect(MARGIN + colW, y, colW, h);
      [slice.left, slice.right].forEach((cell, col) => {
        if (!cell) return;
        const x = MARGIN + col * colW + PAD;
        let ty = y + PAD;
        if (slice.first) {
          ctx.font = `bold ${LABEL}px ${FONTS}`;
          drawText(ctx, cell.label.toUpperCase(), x, ty, textW, cell.rtl, cell.lang);
          ty += labelH;
        }
        ctx.font = `${BODY}px ${FONTS}`;
        for (const line of cell.lines.slice(slice.from, slice.to)) {
          drawText(ctx, line, x, ty, textW, cell.rtl, cell.lang);
          ty += LINE;
        }
      });
      y += h;
    }

    ctx.font = `${LABEL}px ${FONTS}`;
    ctx.textAlign = 'center';
    ctx.direction = 'ltr';
    ctx.fillText(`${labels.page} ${n + 1} / ${pages.length}`, PAGE_W / 2, PAGE_H - MARGIN - LABEL);
    ctx.textAlign = 'left';
    return canvas.toDataURL('image/png');
  });
}

/** The subject of the sheet, in the citizen's language and then in Italian, when they differ. */
function topicLines(labels: DocLabels): { text: string; own: boolean }[] {
  if (!labels.topicIt) return [];
  const own = labels.topicOwn && labels.topicOwn !== labels.topicIt ? [{ text: labels.topicOwn, own: true }] : [];
  return [...own, { text: labels.topicIt, own: false }];
}

function headerHeight(ctx: CanvasRenderingContext2D, labels: DocLabels, width: number): number {
  ctx.font = `${LABEL}px ${FONTS}`;
  const details = labels.details.reduce((sum, line) => sum + wrap(ctx, line, width, 'it').length, 0);
  const titles = labels.titleOwn !== labels.titleIt ? 2 : 1;
  return titles * TITLE_LINE + 20 + topicLines(labels).length * TOPIC_LINE + details * (LABEL + 10) + 30;
}

/** At the top of the first page, the same size: first in the citizen's language, then in Italian. */
function drawHeader(ctx: CanvasRenderingContext2D, labels: DocLabels, lang: string, y: number): number {
  const width = PAGE_W - 2 * MARGIN;
  ctx.font = `bold ${TITLE}px ${FONTS}`;
  if (labels.titleOwn !== labels.titleIt) {
    drawText(ctx, labels.titleOwn, MARGIN, y, width, RTL.includes(lang), lang);
    y += TITLE_LINE;
  }
  drawText(ctx, labels.titleIt, MARGIN, y, width, false, 'it');
  y += TITLE_LINE;
  // A thick rule under the titles.
  ctx.fillRect(MARGIN, y - 4, width, 4);
  y += 20;
  ctx.font = `bold ${TOPIC}px ${FONTS}`;
  for (const line of topicLines(labels)) {
    drawText(ctx, line.text, MARGIN, y, width, line.own && RTL.includes(lang), line.own ? lang : 'it');
    y += TOPIC_LINE;
  }
  ctx.font = `${LABEL}px ${FONTS}`;
  for (const detail of labels.details) {
    for (const line of wrap(ctx, detail, width, 'it')) {
      drawText(ctx, line, MARGIN, y, width, false, 'it');
      y += LABEL + 10;
    }
  }
  return y + 30;
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, rtl: boolean, lang: string): void {
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  (ctx as CanvasRenderingContext2D & { lang?: string }).lang = lang;
  ctx.fillText(text, rtl ? x + width : x, y);
}

/** The text in lines no wider than width, broken between words (or characters, in Chinese). */
export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lang: string): string[] {
  const lines: string[] = [];
  const words = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(lang, { granularity: 'word' }) : null;
  const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(lang, { granularity: 'grapheme' }) : null;

  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    const pieces = words ? Array.from(words.segment(paragraph), (s) => s.segment) : paragraph.split(/(\s+)/);
    let line = '';
    for (const piece of pieces) {
      const next = line + piece;
      if (ctx.measureText(next).width <= width) {
        line = next;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = piece.trimStart();
      // A single word wider than the column is cut between characters.
      while (ctx.measureText(line).width > width) {
        const chars = graphemes ? Array.from(graphemes.segment(line), (s) => s.segment) : Array.from(line);
        let cut = '';
        for (const ch of chars) {
          if (ctx.measureText(cut + ch).width > width) break;
          cut += ch;
        }
        if (!cut) cut = chars[0];
        lines.push(cut);
        line = line.slice(cut.length);
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
