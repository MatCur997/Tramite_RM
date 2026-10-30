import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Chatbot } from './chatbot.component';
import { AppStateService } from '../app-state.service';
import { CHAT_API_URL } from '../api.config';
import { SessionService } from '../session.service';
import { EndDialog } from '../end-dialog.component';

function streamResponse(events: object[]): Response {
  const body = events.map((e) => JSON.stringify(e) + '\n').join('');
  return new Response(body, { status: 200 });
}

describe('Chatbot', () => {
  let state: AppStateService;
  let fetchMock: ReturnType<typeof vi.fn>;

  /** The backend: the chat answers with these events, the list of voices says Italian. */
  function backend(events: object[]): void {
    fetchMock.mockImplementation(async (url: string) =>
      url === `${CHAT_API_URL}/stream` ? streamResponse(events) : new Response(JSON.stringify({ languages: ['it'] }))
    );
  }

  const chatCalls = () => fetchMock.mock.calls.filter(([url]) => url === `${CHAT_API_URL}/stream`);

  beforeEach(async () => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await TestBed.configureTestingModule({
      imports: [Chatbot],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    const httpMock = TestBed.inject(HttpTestingController);
    state = TestBed.inject(AppStateService);
    httpMock.expectOne('assets/translation.json').flush({
      it: {
        chatError: 'Errore di connessione',
        endConfirm: 'Chiudi e cancella',
        restartShort: 'Ricomincia',
        topicFirst: 'Argomento: {titolo}',
        'topic.cie': "Carta d'identità",
        'topicStart.cie': "Come richiedo la carta d'identità elettronica?",
        summaryBring: 'Cosa portare allo sportello'
      }
    });
    state.startChat();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('invia il messaggio e mostra la risposta del bot in streaming', async () => {
    backend([
      { type: 'token', text: 'Serve il ' },
      { type: 'token', text: 'modulo.' },
      { type: 'sources', sources: [{ number: 1, title: 'Residenza', kind: 'doc', url: null }], forms: [] },
      { type: 'done' }
    ]);
    const fixture = TestBed.createComponent(Chatbot);
    fixture.componentInstance.newMessage.set('  cambio residenza?  ');
    const sending = fixture.componentInstance.sendMessage();
    expect(fixture.componentInstance.waiting()).toBe(true);
    await sending;

    const [[, init]] = chatCalls();
    expect(JSON.parse(init.body)).toEqual({
      message: 'cambio residenza?', language: null, session_id: state.sessionId
    });

    const last = state.chatMessages().at(-1)!;
    expect(last.text).toBe('Serve il modulo.');
    expect(last.sources?.[0].title).toBe('Residenza');
    expect(last.topic).toBeNull(); // a backend that does not send the subject
    expect(last.pending).toBe(false);
    expect(state.chatMessages().map((m) => m.text)).toEqual(['cambio residenza?', 'Serve il modulo.']);
    expect(fixture.componentInstance.waiting()).toBe(false);
  });

  it('segna l’argomento della risposta e mostra cosa portare nel riepilogo', async () => {
    backend([
      { type: 'token', text: 'Porta una fototessera [1].' },
      { type: 'sources', topic: 'cie', sources: [{ number: 1, title: 'CIE', kind: 'pagina', url: null, topic: 'cie' }], forms: [] },
      { type: 'summary', bring: ['Fototessera recente'] },
      { type: 'done' }
    ]);
    const fixture = TestBed.createComponent(Chatbot);
    fixture.componentInstance.newMessage.set('Cosa serve per la carta?');
    await fixture.componentInstance.sendMessage();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(state.chatMessages().at(-1)).toMatchObject({ topic: 'cie', bring: ['Fototessera recente'] });
    expect(el.querySelector('app-topic-divider')?.textContent).toContain("Argomento: Carta d'identità");
    expect(el.querySelector('app-summary-panel')?.textContent).toContain('Fototessera recente');
  });

  it('prima della prima domanda un argomento della griglia invia la sua domanda', async () => {
    backend([{ type: 'token', text: 'Ecco.' }, { type: 'done' }]);
    const fixture = TestBed.createComponent(Chatbot);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('app-chat-start .card') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(chatCalls().length).toBe(1));

    expect(JSON.parse(chatCalls()[0][1].body).message).toBe("Come richiedo la carta d'identità elettronica?");
  });

  it('il tasto che ricomincia la lettura ha anche il testo', () => {
    backend([]);
    state.addMessage({ text: 'Porta la foto.', sender: 'bot' });
    const fixture = TestBed.createComponent(Chatbot);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.speak-restart')?.textContent).toContain('Ricomincia');
  });

  it('mostra un errore tradotto se il server non risponde', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const fixture = TestBed.createComponent(Chatbot);
    fixture.componentInstance.newMessage.set('ciao');
    await fixture.componentInstance.sendMessage();
    expect(state.chatMessages().at(-1)).toEqual({ text: 'Errore di connessione', sender: 'bot', pending: false });
  });

  it('ignora i messaggi vuoti', async () => {
    const fixture = TestBed.createComponent(Chatbot);
    fixture.componentInstance.newMessage.set('   ');
    await fixture.componentInstance.sendMessage();
    expect(chatCalls()).toEqual([]);
  });

  it('"Termina" chiede conferma, poi dimentica la conversazione e torna al benvenuto', () => {
    backend([]);
    state.addMessage({ text: 'Carta?', sender: 'user' });
    const fixture = TestBed.createComponent(Chatbot);
    const dialog = TestBed.createComponent(EndDialog);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.end-btn') as HTMLButtonElement).click();
    dialog.detectChanges();

    expect(TestBed.inject(SessionService).confirmingEnd()).toBe(true);
    expect(state.currentStep()).toBe('chatbot'); // nothing is lost before the confirmation
    const confirm = dialog.nativeElement.querySelector('.ed-primary') as HTMLButtonElement;
    expect(confirm.textContent).toContain('Chiudi e cancella');
    confirm.click();

    expect(state.currentStep()).toBe('welcome');
    expect(state.chatMessages()).toEqual([]);
    expect(TestBed.inject(SessionService).confirmingEnd()).toBe(false);
  });
});
