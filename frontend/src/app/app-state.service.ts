import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export type Step = 'welcome' | 'language' | 'choice' | 'chatbot' | 'webapp';
export type Translations = Record<string, Record<string, string>>;
/** Values for the placeholders of a text, such as {n} in "Foglio {n} di {totale}". */
export type TextValues = Record<string, string | number>;

const RTL_LANGUAGES = ['ar'];

export interface ChatSource {
  number: number;
  title: string;
  kind: string;
  url: string | null;
  /** The saved text of the page, shown when the site cannot be opened inside the kiosk. */
  copy?: string | null;
  topic?: string | null;
}

export interface ChatForm {
  id: string;
  title: string;
  url: string;
  topic?: string | null;
}

export interface ChatMessage {
  text: string;
  sender: 'bot' | 'user';
  sources?: ChatSource[];
  forms?: ChatForm[];
  pending?: boolean;
  /** What the answer is about ("cie", "residenza"...): that of its first source; null if none. */
  topic?: string | null;
  /** What to bring to the counter, according to the answer, in the citizen's language. */
  bring?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
  private http = inject(HttpClient);

  readonly currentStep = signal<Step>('welcome');
  readonly selectedLanguage = signal<string | null>(null);
  readonly chatMessages = signal<ChatMessage[]>([]);
  readonly translations = signal<Translations>({});
  sessionId: string = crypto.randomUUID();

  readonly isRtl = computed(() => RTL_LANGUAGES.includes(this.selectedLanguage() ?? ''));
  readonly dir = computed(() => (this.isRtl() ? 'rtl' : 'ltr'));

  constructor() {
    this.loadTranslations();
  }

  loadTranslations(): void {
    this.http.get<Translations>('assets/translation.json').subscribe({
      next: (data) => this.translations.set(data),
      error: (err) => console.error('Errore nel caricamento delle traduzioni:', err)
    });
  }

  /**
   * The text in the citizen's language, or in lang; Italian if it is missing. values fill its
   * placeholders: t('printPage', { n: 1, totale: 3 }) or t('printPage', 'it', { n: 1, totale: 3 }).
   */
  t(key: string, lang: string | null | TextValues = this.selectedLanguage(), values?: TextValues): string {
    if (lang !== null && typeof lang === 'object') {
      values = lang;
      lang = this.selectedLanguage();
    }
    const all = this.translations();
    const text = all[lang || 'it']?.[key] || all['it']?.[key] || key;
    return values ? text.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match)) : text;
  }

  setLanguage(langCode: string): void {
    this.selectedLanguage.set(langCode);
    document.documentElement.lang = langCode;
  }

  readonly languageReturnStep = signal<Step>('welcome');

  openLanguageFromWelcome(): void {
    this.languageReturnStep.set('welcome');
    this.currentStep.set('language');
  }

  goToLanguage(returnStep: Step): void {
    this.languageReturnStep.set(returnStep);
    this.currentStep.set('language');
    this.chatMessages.set([]);
    this.newSession();
  }

  closeLanguage(): void {
    this.currentStep.set(this.languageReturnStep());
  }

  newSession(): void {
    this.sessionId = crypto.randomUUID();
  }

  /** A new conversation: empty, the chat greets the citizen with the subjects to start from. */
  startChat(): void {
    this.chatMessages.set([]);
    this.newSession();
    this.currentStep.set('chatbot');
  }

  /** Back to the welcome screen as the next citizen finds it: no language, no conversation. */
  reset(): void {
    this.selectedLanguage.set(null);
    document.documentElement.lang = 'it';
    this.chatMessages.set([]);
    this.languageReturnStep.set('welcome');
    this.currentStep.set('welcome');
    this.newSession();
  }

  addMessage(message: ChatMessage): void {
    this.chatMessages.update((list) => [...list, message]);
  }

  updateMessage(message: ChatMessage, changes: Partial<ChatMessage>): ChatMessage {
    const updated = { ...message, ...changes };
    this.chatMessages.update((list) => list.map((m) => (m === message ? updated : m)));
    return updated;
  }
}
