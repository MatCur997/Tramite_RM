import { Injectable, computed, inject, signal } from '@angular/core';
import { AppStateService, ChatMessage } from './app-state.service';
import { TRANSLATE_API_URL } from './api.config';
import { DocLabels, DocRow, renderConversation } from './conversation-doc';
import { LinkViewerService } from './link-viewer.service';
import { PrintStopped, printPagesWithProgress, releasePages, renderPdf } from './link-viewer.component/pdf-pages';
import { TopicsService } from './topics';

/** What the citizen asked to print: a form open in the viewer (its pages), or the summary for the counter. */
export interface PrintJob {
  title: string;
  /** Pages of a form, as image URLs; none when the summary for the counter is printed. */
  pages?: string[];
  /** Address of that form: in the list of the dialog it comes selected. */
  url?: string;
}

/** A document of the print dialog: the summary of a subject for the counter, or a form. */
export interface PrintDoc {
  key: string;
  kind: 'summary' | 'form';
  title: string;
  /** Its sheets, as image URLs, once ready. */
  pages: string[];
  state: 'loading' | 'ready' | 'error';
  selected: boolean;
}

/** The documents about one subject; topic null: the whole conversation, or a form on its own. */
export interface PrintGroup {
  topic: string | null;
  docs: PrintDoc[];
}

export type PrintStatus = 'confirm' | 'preview' | 'printing' | 'done' | 'error';

/** Most the printer endpoint accepts in one job. */
const MAX_PAGES = 50;
/** Most texts the translation endpoint accepts in one request. */
const MAX_TEXTS = 60;
/** After a print that went well the dialog closes by itself. */
const DONE_CLOSE_MS = 5000;

/**
 * Printing on the kiosk. A dialog first lists, subject by subject, what can be printed: the
 * summary for the counter (what to bring and the conversation, with the Italian translation when
 * the citizen speaks another language) and the forms of the subject. The citizen unticks what
 * they do not need; then the backend sends the sheets to the Bluetooth printer, without any
 * dialog, and reports them one by one.
 */
@Injectable({ providedIn: 'root' })
export class PrintService {
  private state = inject(AppStateService);
  private topics = inject(TopicsService);
  private viewer = inject(LinkViewerService);

  /** The job waiting for confirmation or being printed; null when the dialog is closed. */
  readonly job = signal<PrintJob | null>(null);
  readonly status = signal<PrintStatus>('confirm');
  readonly groups = signal<PrintGroup[]>([]);
  /** The document shown full size in the dialog, and its page. */
  readonly preview = signal<PrintDoc | null>(null);
  readonly previewPage = signal(0);
  /** The sheets printed so far (null until the printer reports one) and in all; null: not reported. */
  readonly progress = signal<{ printed: number | null; total: number } | null>(null);
  /** The sheet where the last print stopped, when the backend said it. */
  readonly stoppedAt = signal<number | null>(null);
  /** The sheets of the print in course or just ended. */
  readonly total = signal(0);

  readonly busy = computed(() => this.status() === 'printing');

  /** The messages of the conversation that are worth printing: from the first question on. */
  readonly conversation = computed(() => {
    const messages = this.state.chatMessages();
    const first = messages.findIndex((m) => m.sender === 'user');
    if (first < 0) return [] as ChatMessage[];
    return messages.slice(first).filter((m) => !m.pending && m.text.trim());
  });

  /** A conversation with at least one answer: its summary for the counter can be printed. */
  readonly conversationPrintable = computed(
    () => this.state.currentStep() === 'chatbot' && this.conversation().some((m) => m.sender === 'bot')
  );

  readonly selected = computed(() => this.groups().flatMap((group) => group.docs).filter((doc) => doc.selected));
  /** The sheets that the selection prints; a summary still being prepared counts as one. */
  readonly sheets = computed(() =>
    Math.min(MAX_PAGES, this.selected().reduce((n, doc) => n + (doc.state === 'ready' ? doc.pages.length : 1), 0))
  );
  readonly canPrint = computed(() => this.selected().length > 0 && this.selected().every((doc) => doc.state === 'ready'));

  /** Changes at every opening and closing: what a render or a print finishes late is dropped. */
  private run = 0;
  /** The pages of forms rendered here, released when the dialog closes (the viewer's are its own). */
  private owned: string[] = [];
  /** The sheets of the print in course. */
  private pages: string[] = [];
  private closeTimer?: ReturnType<typeof setTimeout>;

  /** Opens the dialog: from the viewer for its form, or for the summary for the counter. */
  ask(job: PrintJob): void {
    if (this.busy()) return;
    this.close();
    const run = ++this.run;
    this.job.set(job);
    this.groups.set(this.build(job));
    // Summaries wait for the translation, forms for pdf.js: two queues, so neither waits for the other.
    const docs = this.groups().flatMap((group) => group.docs).filter((doc) => doc.state === 'loading');
    void this.prepareAll(run, docs.filter((doc) => doc.kind === 'summary'));
    void this.prepareAll(run, docs.filter((doc) => doc.kind === 'form'));
  }

  cancel(): void {
    if (this.busy()) return;
    this.close();
  }

  toggle(doc: PrintDoc): void {
    this.updateDoc(doc.key, (current) => ({ ...current, selected: !current.selected }));
  }

  showPreview(doc: PrintDoc): void {
    if (doc.state !== 'ready' || !doc.pages.length) return;
    this.preview.set(doc);
    this.previewPage.set(0);
    this.status.set('preview');
  }

  turnPage(delta: number): void {
    const doc = this.preview();
    if (doc) this.previewPage.set(Math.min(Math.max(this.previewPage() + delta, 0), doc.pages.length - 1));
  }

  backToList(): void {
    this.preview.set(null);
    this.status.set('confirm');
  }

  async confirm(): Promise<void> {
    if (!this.job() || this.busy() || !this.canPrint()) return;
    this.pages = this.selected().flatMap((doc) => doc.pages).slice(0, MAX_PAGES);
    await this.print(0);
  }

  /** After a print that stopped: again from the sheet where it stopped (all, if unknown). */
  async retry(): Promise<void> {
    if (this.status() !== 'error') return;
    await this.print((this.stoppedAt() ?? 1) - 1);
  }

  private async print(from: number): Promise<void> {
    const run = this.run;
    const total = this.pages.length;
    this.total.set(total);
    this.status.set('printing');
    this.stoppedAt.set(null);
    this.progress.set({ printed: null, total });
    try {
      await printPagesWithProgress(this.pages.slice(from), (event) => {
        if (run !== this.run) return;
        if (event.type === 'page') this.progress.set({ printed: from + event.page, total });
        if (event.type === 'unknown') this.progress.set(null);
      });
      if (run !== this.run) return;
      this.status.set('done');
      this.closeTimer = setTimeout(() => this.close(), DONE_CLOSE_MS);
    } catch (err) {
      if (run !== this.run) return;
      console.error('Stampa non riuscita:', err);
      const page = err instanceof PrintStopped ? err.page : null;
      this.stoppedAt.set(page === null ? null : from + page);
      this.status.set('error');
    }
  }

  private close(): void {
    clearTimeout(this.closeTimer);
    this.run++;
    releasePages(this.owned);
    this.owned = [];
    this.pages = [];
    this.job.set(null);
    this.groups.set([]);
    this.preview.set(null);
    this.progress.set(null);
    this.stoppedAt.set(null);
    this.total.set(0);
    this.status.set('confirm');
  }

  /**
   * The documents, subject by subject: the summary for the counter, selected, then the forms of
   * the subject, selected when the citizen opened them, when they are its only form, or when the
   * print starts from their viewer. Without subjects (a backend that does not send them), the
   * summary of the whole conversation.
   */
  private build(job: PrintJob): PrintGroup[] {
    const opened = this.viewer.opened();
    const seen = new Set<string>();
    const groups: PrintGroup[] = [];
    for (const section of this.topics.sections()) {
      const forms = [];
      for (const form of section.forms) {
        if (seen.has(form.url)) continue;
        seen.add(form.url);
        forms.push(form);
      }
      const docs = forms.map((form) => this.formDoc(form.url, form.title, job, opened.has(form.url) || forms.length === 1));
      groups.push({ topic: section.topic, docs: [this.summaryDoc(section.topic), ...docs] });
    }
    if (!groups.length && this.conversationPrintable()) {
      groups.push({ topic: null, docs: [this.summaryDoc(null)] });
    }
    // A form printed from the viewer that no subject of the conversation lists: on its own, first.
    if (job.pages?.length && !seen.has(job.url ?? '')) {
      groups.unshift({ topic: null, docs: [this.formDoc(job.url ?? job.title, job.title, job, true)] });
    }
    return groups;
  }

  private summaryDoc(topic: string | null): PrintDoc {
    const title = this.state.t('printSummaryDoc');
    return { key: `summary:${topic ?? ''}`, kind: 'summary', title, pages: [], state: 'loading', selected: true };
  }

  private formDoc(url: string, title: string, job: PrintJob, selected: boolean): PrintDoc {
    const own = !!job.pages?.length && (job.url ?? job.title) === url;
    return { key: `form:${url}`, kind: 'form', title, pages: own ? job.pages! : [], state: own ? 'ready' : 'loading', selected: own || selected };
  }

  private async prepareAll(run: number, docs: PrintDoc[]): Promise<void> {
    for (const doc of docs) {
      if (run !== this.run) return;
      try {
        const pages = doc.kind === 'form' ? await renderPdf(doc.key.slice(5)) : await this.summaryPages(doc.key.slice(8) || null);
        if (run !== this.run) {
          if (doc.kind === 'form') releasePages(pages);
          return;
        }
        if (doc.kind === 'form') this.owned.push(...pages);
        this.updateDoc(doc.key, (current) => ({ ...current, pages, state: pages.length ? 'ready' : 'error', selected: current.selected && !!pages.length }));
      } catch (err) {
        if (run !== this.run) return;
        console.error('Documento da stampare non disponibile:', err);
        this.updateDoc(doc.key, (current) => ({ ...current, state: 'error', selected: false }));
      }
    }
  }

  private updateDoc(key: string, change: (doc: PrintDoc) => PrintDoc): void {
    this.groups.update((groups) =>
      groups.map((group) => ({ ...group, docs: group.docs.map((doc) => (doc.key === key ? change(doc) : doc)) }))
    );
    const shown = this.preview();
    if (shown?.key === key) this.preview.set(this.groups().flatMap((group) => group.docs).find((doc) => doc.key === key) ?? shown);
  }

  /**
   * The summary of a subject for the counter (topic null: of the whole conversation): what to
   * bring, then the questions and answers, with the Italian translation beside them when the
   * citizen speaks another language.
   */
  private async summaryPages(topic: string | null): Promise<string[]> {
    const lang = this.state.selectedLanguage() ?? 'it';
    const all = this.state.chatMessages();
    const section = topic ? this.topics.sections().find((s) => s.topic === topic) : undefined;
    const messages = (section ? section.messages.map((i) => all[i]) : this.conversation()).filter(
      (m) => m && !m.pending && m.text.trim()
    );
    const bring = section ? section.bring : [...new Set(this.conversation().flatMap((m) => m.bring ?? []))];
    const texts = [...bring, ...messages.map((m) => m.text)];
    const italian = lang === 'it' ? texts : await translate(lang, texts);

    const rows: DocRow[] = [];
    if (bring.length) {
      const list = (items: string[]) => items.map((item) => `• ${item}`).join('\n');
      rows.push({ sender: 'bring', original: list(bring), italian: list(italian.slice(0, bring.length)) });
    }
    messages.forEach((m, i) => rows.push({ sender: m.sender, original: m.text, italian: italian[bring.length + i] ?? '' }));
    return renderConversation(lang, rows, this.labels(lang, topic));
  }

  private labels(lang: string, topic: string | null): DocLabels {
    const t = (key: string, l: string | null = lang) => this.state.t(key, l);
    const now = new Date().toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' });
    const italianName = languageName(lang, 'it');
    const ownName = languageName(lang, lang);
    return {
      // "Porta questo foglio allo sportello", in the citizen's language and in Italian.
      titleIt: t('convBring', 'it'),
      titleOwn: t('convBring'),
      topicIt: topic ? `${t('convTopic', 'it')}: ${this.topics.title(topic, 'it')}` : undefined,
      topicOwn: topic ? `${t('convTopic')}: ${this.topics.title(topic, lang)}` : undefined,
      bringIt: t('convBringLabel', 'it'),
      bringOwn: t('convBringLabel'),
      languageOwn: ownName,
      languageIt: languageName('it', 'it'),
      citizenOwn: t('convCitizen'),
      citizenIt: t('convCitizen', 'it'),
      assistantOwn: t('convAssistant'),
      assistantIt: t('convAssistant', 'it'),
      details: [
        t('convDocTitle', 'it'),
        `${t('convDocDate', 'it')}: ${now}`,
        `${t('convDocLanguage', 'it')}: ${italianName}${ownName !== italianName ? ` (${ownName})` : ''}`,
        // The note on the automatic translation, only where there is one.
        ...(lang !== 'it' ? [t('convDocNote', 'it')] : [])
      ],
      page: t('viewerPage', 'it')
    };
  }
}

/** The texts in Italian, in the same order, at most MAX_TEXTS per request. */
async function translate(lang: string, texts: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < texts.length; i += MAX_TEXTS) {
    const response = await fetch(TRANSLATE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang, texts: texts.slice(i, i + MAX_TEXTS) })
    });
    if (!response.ok) throw new Error(`Traduzione: HTTP ${response.status}`);
    out.push(...((await response.json()).texts as string[]));
  }
  return out;
}

/** "Arabo", "العربية"... with a capital letter. */
function languageName(code: string, inLanguage: string): string {
  try {
    const name = new Intl.DisplayNames([inLanguage], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(inLanguage) + name.slice(1);
  } catch {
    return code;
  }
}
