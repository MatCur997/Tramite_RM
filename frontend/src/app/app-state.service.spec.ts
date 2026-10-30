import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AppStateService } from './app-state.service';

describe('AppStateService.t', () => {
  let state: AppStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    state = TestBed.inject(AppStateService);
    state.translations.set({
      it: { printProgress: 'Stampa in corso: foglio {n} di {totale}', back: 'Indietro' },
      uk: { printProgress: 'Друк: аркуш {n} з {totale}' }
    });
    state.setLanguage('uk');
  });

  it('riempie i segnaposto, nella lingua scelta o in quella indicata', () => {
    expect(state.t('printProgress', { n: 1, totale: 3 })).toBe('Друк: аркуш 1 з 3');
    expect(state.t('printProgress', 'it', { n: 2, totale: 3 })).toBe('Stampa in corso: foglio 2 di 3');
  });

  it('le chiamate senza valori restano come prima', () => {
    expect(state.t('back')).toBe('Indietro'); // missing in Ukrainian: the Italian text
    expect(state.t('printProgress', 'it')).toBe('Stampa in corso: foglio {n} di {totale}');
    expect(state.t('sconosciuta')).toBe('sconosciuta');
  });
});
