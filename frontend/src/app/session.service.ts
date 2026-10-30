import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { AppStateService } from './app-state.service';
import { A11yPrefs, AccessibilityService, DEFAULT_PREFS } from './accessibility.service';
import { LinkViewerService } from './link-viewer.service';
import { PrintService } from './print.service';
import { SpeechService } from './speech.service';
import { TopicsService } from './topics';

/** After this long without a touch or a key press the kiosk is handed to the next citizen. */
export const IDLE_TIMEOUT_MS = 90_000;
/** The last seconds of it, counted down in a dialog: a touch keeps the session. */
export const IDLE_WARNING_SECONDS = 20;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/**
 * One citizen's use of the kiosk. It ends with the "Fine" button, or after IDLE_TIMEOUT_MS
 * without activity, and then nothing of it is left on the screen: language, conversation,
 * accessibility choices, open file or page, print dialog, dictation and reading aloud. The
 * backend forgets the conversation by itself (TOTEM_SESSION_TTL_MINUTES): the next citizen
 * gets a new session id.
 */
@Injectable({ providedIn: 'root' })
export class SessionService implements OnDestroy {
  private state = inject(AppStateService);
  private a11y = inject(AccessibilityService);
  private viewer = inject(LinkViewerService);
  private printer = inject(PrintService);
  private speech = inject(SpeechService);
  private topics = inject(TopicsService);

  /** Seconds left before the session ends, while the warning is shown; null otherwise. */
  readonly secondsLeft = signal<number | null>(null);
  /** True while an answer arrives: the chat sets it, and the inactivity timer waits for it. */
  readonly answering = signal(false);
  /** How many sessions have ended: what outlives the screens (the accessibility panel) closes. */
  readonly ended = signal(0);
  /** The chat's end key was touched: "Vuoi chiudere e cancellare la conversazione?" is shown. */
  readonly confirmingEnd = signal(false);

  private idleTimer?: ReturnType<typeof setTimeout>;
  private countdown?: ReturnType<typeof setInterval>;
  private readonly listeners = new AbortController();

  constructor() {
    this.watch(document);
    this.touch();
  }

  ngOnDestroy(): void {
    this.listeners.abort();
    clearTimeout(this.idleTimer);
    clearInterval(this.countdown);
  }

  /** Counts the touches and key presses in this document (the kiosk's, or its web app's) as activity. */
  watch(doc: Document): void {
    for (const type of ACTIVITY_EVENTS) {
      // While the warning is shown only its buttons count: a stray touch must not hide them mid-tap.
      doc.addEventListener(type, () => this.secondsLeft() === null && this.touch(), {
        capture: true,
        passive: true,
        signal: this.listeners.signal
      });
    }
  }

  /** Restarts the inactivity timer and hides the warning: every touch, key press and "Continue". */
  touch(): void {
    clearTimeout(this.idleTimer);
    this.stopCountdown();
    this.idleTimer = setTimeout(() => this.onIdle(), IDLE_TIMEOUT_MS - IDLE_WARNING_SECONDS * 1000);
  }

  /** Asks the citizen before ending: the conversation cannot be brought back. */
  askEnd(): void {
    this.confirmingEnd.set(true);
  }

  /** Forgets everything about the citizen and goes back to the welcome screen. */
  end(): void {
    this.confirmingEnd.set(false);
    this.speech.stopAll();
    this.printer.cancel();
    this.viewer.forget();
    this.topics.viewed.set(null);
    this.a11y.reset();
    this.state.reset();
    this.answering.set(false);
    this.ended.update((n) => n + 1);
    this.touch();
  }

  private onIdle(): void {
    if (this.busy() || this.fresh()) {
      this.touch();
      return;
    }
    this.secondsLeft.set(IDLE_WARNING_SECONDS);
    this.countdown = setInterval(() => {
      const left = (this.secondsLeft() ?? 1) - 1;
      if (left > 0) {
        this.secondsLeft.set(left);
      } else {
        this.end();
      }
    }, 1000);
  }

  private stopCountdown(): void {
    clearInterval(this.countdown);
    this.secondsLeft.set(null);
  }

  /** The citizen is waiting for something: an answer, a transcription, a reading, a print. */
  private busy(): boolean {
    return (
      this.answering() ||
      this.speech.listening() ||
      this.speech.transcribing() ||
      this.speech.speaking() !== null ||
      this.printer.busy()
    );
  }

  /** Nothing to forget: the kiosk is already as the next citizen should find it. */
  private fresh(): boolean {
    const prefs = this.a11y.prefs();
    return (
      this.state.currentStep() === 'welcome' &&
      this.state.selectedLanguage() === null &&
      !this.state.chatMessages().length &&
      !this.viewer.link() &&
      !this.printer.job() &&
      (Object.keys(DEFAULT_PREFS) as (keyof A11yPrefs)[]).every((key) => prefs[key] === DEFAULT_PREFS[key])
    );
  }
}
