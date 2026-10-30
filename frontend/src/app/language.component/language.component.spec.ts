import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { Language, RETURN_DELAY_MS } from './language.component';
import { AppStateService } from '../app-state.service';

describe('Language', () => {
  let component: Language;
  let fixture: ComponentFixture<Language>;
  let state: AppStateService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Language],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(Language);
    component = fixture.componentInstance;
    state = TestBed.inject(AppStateService);
    state.translations.set({
      it: { chooseLang: 'Scegli la tua lingua', back: 'Indietro', langSelected: 'Selezionata' },
      ar: { chooseLang: 'اختر لغتك', back: 'رجوع' }
    });
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('senza lingua scelta evidenzia l’italiano', () => {
    fixture.detectChanges();
    const selected = (fixture.nativeElement as HTMLElement).querySelectorAll('.language-card.selected');
    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toContain('Italiano');
    expect(selected[0].querySelector('.selected-label')?.textContent).toBe('Selezionata');
    expect(selected[0].getAttribute('aria-checked')).toBe('true');
  });

  it('sotto il titolo la stessa frase nelle altre lingue, ognuna con la sua scrittura', () => {
    fixture.detectChanges();
    const others = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.lang-others span')];

    expect(others.map((span) => span.getAttribute('lang'))).toEqual(['uk', 'zh', 'bn', 'tl', 'ar']);
    expect(others.at(-1)?.getAttribute('dir')).toBe('rtl');
  });

  it('il tocco applica subito la lingua, anche in RTL, poi torna indietro', () => {
    vi.useFakeTimers();
    state.openLanguageFromWelcome();
    component.selectLanguage(component.languages.find((l) => l.code === 'ar')!);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(state.selectedLanguage()).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(el.querySelector('h1')?.textContent).toContain('اختر لغتك');
    expect(el.querySelector('.page')?.getAttribute('dir')).toBe('rtl');
    expect(state.currentStep()).toBe('language');

    vi.advanceTimersByTime(RETURN_DELAY_MS);
    expect(state.currentStep()).toBe('welcome');
  });

  it('"Indietro" torna alla schermata da cui si è arrivati', () => {
    state.goToLanguage('choice');
    component.back();
    expect(state.currentStep()).toBe('choice');
  });
});
