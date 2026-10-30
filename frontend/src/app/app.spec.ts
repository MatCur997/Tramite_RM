import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { AppStateService } from './app-state.service';
import translations from '../assets/translation.json';
import { vi } from 'vitest';
import { RETURN_DELAY_MS } from './language.component/language.component';

describe('App', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  function render() {
    const fixture = TestBed.createComponent(App);
    httpMock.expectOne('assets/translation.json').flush(translations);
    fixture.detectChanges();
    return fixture;
  }

  function renderLanguage() {
    const fixture = render();
    (fixture.nativeElement.querySelector('.lang-switch') as HTMLButtonElement).click();
    fixture.detectChanges();
    return fixture;
  }

  function chooseLanguage(fixture: ReturnType<typeof render>, index: number) {
    vi.useFakeTimers();
    (fixture.nativeElement.querySelectorAll('.language-card')[index] as HTMLButtonElement).click();
    vi.advanceTimersByTime(RETURN_DELAY_MS);
    vi.useRealTimers();
    fixture.detectChanges();
  }

  it('parte dalla schermata col logo e al tocco porta alla scelta tra assistente e uffici', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.welcome img')?.getAttribute('alt')).toBe('Tramite – Sportello digitale multilingue');
    expect(el.querySelector('.welcome .cta')?.textContent).toContain('Tocca lo schermo per iniziare');
    (el.querySelector('.welcome') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toContain('Cosa vuoi fare?');
    expect(el.querySelector('.choice-assistant')?.textContent).toContain("Parla con l'assistente");
    expect(el.querySelector('.choice-offices')?.textContent).toContain("Trova l'ufficio più vicino");
  });

  it('"Trova un ufficio" apre il sito nella lingua scelta e "Indietro" torna alla scelta', () => {
    const fixture = renderLanguage();
    const el = fixture.nativeElement as HTMLElement;
    chooseLanguage(fixture, 5);
    (el.querySelector('.welcome') as HTMLElement).click();
    fixture.detectChanges();
    (el.querySelector('.choice-offices') as HTMLButtonElement).click();
    fixture.detectChanges();

    const frame = el.querySelector('iframe.webapp') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('webapp/index.html?lang=ar&embed=1');
    expect(el.querySelector('app-accessibility')).toBeNull();

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'tramite:back' }, origin: 'https://altro-sito.example' }));
    fixture.detectChanges();
    expect(el.querySelector('iframe.webapp')).toBeTruthy();

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'tramite:back' }, origin: location.origin }));
    fixture.detectChanges();
    expect(el.querySelector('.choice-offices')).toBeTruthy();
  });

  it('in alto a destra sempre accessibilità e lingua; Indietro e logo dopo il benvenuto, "Termina" solo in chat', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    const keys = () => [...el.querySelectorAll('.tc-end > *')].map((key) => key.localName === 'app-accessibility' ? 'accessibilità' : key.className.split(' ')[0]);
    expect(keys()).toEqual(['accessibilità', 'lang-switch']);
    expect(el.querySelector('.back-btn, .tc-logo')).toBeNull();

    (el.querySelector('.welcome') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.tc-logo')).toBeTruthy();
    (el.querySelector('.choice-assistant') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(keys()).toEqual(['accessibilità', 'lang-switch', 'end-btn']);
    expect(el.querySelector('.a11y-fab')).toBeNull(); // no floating key any more
  });

  it('il pulsante lingua apre la scelta senza avviare il percorso', () => {
    const el = renderLanguage().nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Scegli la tua lingua');
    expect(el.querySelectorAll('.language-card').length).toBe(6);
    expect(el.querySelector('app-top-controls app-accessibility .a11y-btn')).toBeTruthy();
    expect(el.querySelector('.lang-switch')?.getAttribute('aria-current')).toBe('page');
  });

  it('"Indietro" dalla scelta lingua torna al benvenuto senza cambiare lingua', () => {
    const fixture = renderLanguage();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('.back-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.welcome')).toBeTruthy();
    expect(TestBed.inject(AppStateService).selectedLanguage()).toBeNull();
  });

  it('percorre lingua → benvenuto → assistente → chat', () => {
    const fixture = renderLanguage();
    const el = fixture.nativeElement as HTMLElement;

    chooseLanguage(fixture, 1);
    expect(el.querySelector('.welcome .cta')?.textContent).toContain('Торкніться екрана');

    (el.querySelector('.welcome') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toContain('Що ви хочете зробити?');
    (el.querySelector('.choice-assistant') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('.chat-header h1')?.textContent).toContain('Помічник реєстру населення');
    expect(el.querySelector('app-chat-start .greeting')?.textContent).toContain('Добрий день');
    expect(el.querySelector('.message-bubble')).toBeNull(); // the conversation starts empty
  });

  it('il pulsante accessibilità segue la lingua scelta', () => {
    const fixture = renderLanguage();
    const el = fixture.nativeElement as HTMLElement;
    const fab = () => el.querySelector('app-accessibility .a11y-btn')?.getAttribute('aria-label');
    expect(fab()).toBe('Opzioni di accessibilità');

    chooseLanguage(fixture, 1);
    expect(fab()).toBe('Параметри доступності');
  });

  it('all’avvio parte in italiano anche se un utente precedente aveva scelto un’altra lingua', () => {
    localStorage.setItem('selectedLanguage', 'zh');
    const el = render().nativeElement as HTMLElement;
    expect(TestBed.inject(AppStateService).selectedLanguage()).toBeNull();
    expect(el.querySelector('app-accessibility .a11y-btn')?.getAttribute('aria-label')).toBe('Opzioni di accessibilità');
  });
});
