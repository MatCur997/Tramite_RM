import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { AppStateService } from './app-state.service';
import { AccessibilityService } from './accessibility.service';
import { LinkViewerService } from './link-viewer.service';
import { IDLE_TIMEOUT_MS, IDLE_WARNING_SECONDS, SessionService } from './session.service';

/** Inactivity before the warning appears. */
const UNTIL_WARNING = IDLE_TIMEOUT_MS - IDLE_WARNING_SECONDS * 1000;

describe('SessionService', () => {
  let session: SessionService;
  let state: AppStateService;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    session = TestBed.inject(SessionService);
    state = TestBed.inject(AppStateService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  /** A citizen in the middle of a conversation in Ukrainian, with larger text and a form open. */
  function citizen(): void {
    state.setLanguage('uk');
    state.startChat();
    state.addMessage({ text: 'Як змінити адресу?', sender: 'user' });
    TestBed.inject(AccessibilityService).increaseText();
    TestBed.inject(LinkViewerService).open({ url: 'http://localhost:8000/files/modulo.pdf', title: 'Modulo' });
  }

  it('senza tocchi avvisa, e alla fine del conto alla rovescia dimentica tutto', () => {
    citizen();
    const id = state.sessionId;

    vi.advanceTimersByTime(UNTIL_WARNING);
    expect(session.secondsLeft()).toBe(IDLE_WARNING_SECONDS);
    vi.advanceTimersByTime(1000);
    expect(session.secondsLeft()).toBe(IDLE_WARNING_SECONDS - 1);

    vi.advanceTimersByTime((IDLE_WARNING_SECONDS - 1) * 1000);
    expect(session.secondsLeft()).toBeNull();
    expect(state.currentStep()).toBe('welcome');
    expect(state.selectedLanguage()).toBeNull();
    expect(state.chatMessages()).toEqual([]);
    expect(state.sessionId).not.toBe(id);
    expect(document.documentElement.lang).toBe('it');
    expect(TestBed.inject(AccessibilityService).prefs().fs).toBe(100);
    expect(TestBed.inject(LinkViewerService).link()).toBeNull();
  });

  it('un tocco rimette il conto da capo', () => {
    citizen();
    vi.advanceTimersByTime(UNTIL_WARNING - 1000);
    document.dispatchEvent(new Event('pointerdown'));

    vi.advanceTimersByTime(UNTIL_WARNING - 1000);
    expect(session.secondsLeft()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(session.secondsLeft()).toBe(IDLE_WARNING_SECONDS);
  });

  it('durante l’avviso un tocco qualsiasi non lo nasconde: contano solo i suoi pulsanti', () => {
    citizen();
    vi.advanceTimersByTime(UNTIL_WARNING);
    document.dispatchEvent(new Event('pointerdown'));
    expect(session.secondsLeft()).toBe(IDLE_WARNING_SECONDS);
  });

  it('"Continua" nasconde l’avviso e mantiene la conversazione', () => {
    citizen();
    vi.advanceTimersByTime(UNTIL_WARNING + 5000);
    session.touch();

    expect(session.secondsLeft()).toBeNull();
    vi.advanceTimersByTime(IDLE_WARNING_SECONDS * 1000);
    expect(state.currentStep()).toBe('chatbot');
    expect(state.chatMessages().map((m) => m.text)).toEqual(['Як змінити адресу?']);
  });

  it('non interrompe una risposta che sta arrivando', () => {
    citizen();
    session.answering.set(true);
    vi.advanceTimersByTime(UNTIL_WARNING * 2);
    expect(session.secondsLeft()).toBeNull();

    session.answering.set(false);
    vi.advanceTimersByTime(UNTIL_WARNING);
    expect(session.secondsLeft()).toBe(IDLE_WARNING_SECONDS);
  });

  it('a totem già libero non mostra nessun avviso', () => {
    vi.advanceTimersByTime(UNTIL_WARNING * 3);
    expect(session.secondsLeft()).toBeNull();
    expect(session.ended()).toBe(0);
  });

  it('"Fine" dimentica subito tutto', () => {
    citizen();
    session.end();

    expect(state.currentStep()).toBe('welcome');
    expect(state.chatMessages()).toEqual([]);
    expect(TestBed.inject(LinkViewerService).link()).toBeNull();
    expect(session.ended()).toBe(1);
  });
});
