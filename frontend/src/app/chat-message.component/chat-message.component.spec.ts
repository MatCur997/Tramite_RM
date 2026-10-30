import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AppStateService } from '../app-state.service';
import { ChatMessageView, textParts } from './chat-message.component';

describe('textParts', () => {
  it('separa il testo dai numeri delle fonti, anche con le parentesi e le virgole cinesi e arabe', () => {
    expect(textParts('Porta la foto [1]. Costa 22 euro [1, 3].')).toEqual([
      { text: 'Porta la foto ' },
      { cites: [1] },
      { text: '. Costa 22 euro ' },
      { cites: [1, 3] },
      { text: '.' }
    ]);
    expect(textParts('需要照片【2】和表格［1，2］')).toEqual([
      { text: '需要照片' },
      { cites: [2] },
      { text: '和表格' },
      { cites: [1, 2] }
    ]);
    expect(textParts('أحضر الصورة [1، 2]')).toEqual([{ text: 'أحضر الصورة ' }, { cites: [1, 2] }]);
    expect(textParts('Nessuna fonte, solo [nota].')).toEqual([{ text: 'Nessuna fonte, solo [nota].' }]);
  });
});

describe('ChatMessageView', () => {
  it('mostra le fonti come badge che gli screen reader leggono "fonte 1"', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.inject(AppStateService).translations.set({ it: { sourceWord: 'fonte' } });
    const fixture = TestBed.createComponent(ChatMessageView);
    fixture.componentRef.setInput('message', { text: 'Serve la foto [1].', sender: 'bot' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.message-text')?.textContent).toBe('Serve la foto fonte 1.');
    expect(el.querySelector('.cite')?.textContent).toBe('fonte 1');
    expect(el.querySelector('.cite .sr-only')?.textContent).toBe('fonte ');
    expect(el.querySelector('.speak-controls')).toBeNull(); // reading keys only when asked for
  });
});
