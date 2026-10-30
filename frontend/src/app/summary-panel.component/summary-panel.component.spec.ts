import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AppStateService } from '../app-state.service';
import { SummaryPanel } from './summary-panel.component';

describe('SummaryPanel', () => {
  it('nelle righe chiuse conta solo quello che c’è, senza accordare il nome al numero', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const state = TestBed.inject(AppStateService);
    state.translations.set({
      it: { summaryBringCount: 'Da portare: {n}', summaryFormsCount: 'Moduli: {n}', 'topic.cie': "Carta d'identità" }
    });
    const form = { id: 'f', title: 'Modulo CIE', url: 'http://x/f.pdf', topic: 'cie' };
    state.chatMessages.set([
      { text: 'Carta?', sender: 'user' },
      { text: 'Serve il modulo [1].', sender: 'bot', topic: 'cie', forms: [form] }, // no summary: nothing to bring
      { text: 'Residenza?', sender: 'user' },
      { text: 'Serve un documento.', sender: 'bot', topic: 'residenza', bring: ['Documento'] }
    ]);
    const fixture = TestBed.createComponent(SummaryPanel);
    fixture.detectChanges();

    const closed = fixture.nativeElement.querySelector('.topic.closed') as HTMLElement;
    expect(closed.textContent).toContain("Carta d'identità");
    expect(closed.querySelector('.counts')?.textContent).toBe('Moduli: 1');
  });
});
