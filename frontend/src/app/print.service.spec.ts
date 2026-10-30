import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { AppStateService } from './app-state.service';
import { LinkViewerService } from './link-viewer.service';
import { PRINT_API_URL, PRINT_STREAM_API_URL } from './api.config';
import { PrintService } from './print.service';

const PAGES = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB', 'data:image/png;base64,CCCC'];
const FORM_URL = 'http://localhost:8000/files/modulo-richiesta-cie.pdf';

function ndjson(events: object[]): Response {
  return new Response(events.map((e) => JSON.stringify(e) + '\n').join(''), { status: 200 });
}

describe('PrintService', () => {
  let print: PrintService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    print = TestBed.inject(PrintService);
  });

  afterEach(() => {
    print.cancel();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A form printed from its viewer, with no conversation around it. */
  const askForm = () => print.ask({ title: 'Modulo CIE', pages: PAGES, url: FORM_URL });

  it('elenca il modulo aperto, selezionato, e conta i fogli della selezione', () => {
    askForm();

    expect(print.groups()).toEqual([
      { topic: null, docs: [expect.objectContaining({ kind: 'form', title: 'Modulo CIE', state: 'ready', selected: true })] }
    ]);
    expect(print.sheets()).toBe(3);
    expect(print.canPrint()).toBe(true);

    print.toggle(print.groups()[0].docs[0]);
    expect(print.sheets()).toBe(0);
    expect(print.canPrint()).toBe(false);
  });

  it('anche senza indirizzo le pagine date sono pronte da stampare', () => {
    print.ask({ title: 'Pagine', pages: PAGES });

    expect(print.groups()[0].docs[0]).toMatchObject({ kind: 'form', state: 'ready', selected: true, pages: PAGES });
  });

  it('raggruppa per argomento: il riepilogo selezionato, i moduli se aperti, unici o stampati dal loro visore', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = TestBed.inject(AppStateService);
    state.currentStep.set('chatbot');
    const form = (id: string, topic: string) => ({ id, title: `Modulo ${id}`, url: `http://x/${id}.pdf`, topic });
    state.chatMessages.set([
      { text: 'Carta?', sender: 'user' },
      { text: 'Serve la foto [1].', sender: 'bot', topic: 'cie', forms: [form('a', 'cie'), form('b', 'cie')] },
      { text: 'Residenza?', sender: 'user' },
      { text: 'Serve il modulo [1].', sender: 'bot', topic: 'residenza', forms: [form('c', 'residenza')] }
    ]);
    TestBed.inject(LinkViewerService).open({ url: 'http://x/b.pdf', title: 'Modulo b' });

    print.ask({ title: 'Modulo c', pages: PAGES, url: 'http://x/c.pdf' });

    const groups = print.groups().map((group) => [group.topic, group.docs.map((doc) => `${doc.kind} ${doc.title} ${doc.selected}`)]);
    expect(groups).toEqual([
      ['cie', ['summary printSummaryDoc true', 'form Modulo a false', 'form Modulo b true']],
      ['residenza', ['summary printSummaryDoc true', 'form Modulo c true']]
    ]);
  });

  it('segue la stampa foglio per foglio fino alla fine', async () => {
    fetchMock.mockResolvedValue(ndjson([
      { type: 'prepared', total: 3 },
      { type: 'page', page: 1, total: 3 },
      { type: 'page', page: 2, total: 3 },
      { type: 'page', page: 3, total: 3 },
      { type: 'done', total: 3 }
    ]));
    askForm();

    await print.confirm();

    expect(fetchMock.mock.calls[0][0]).toBe(PRINT_STREAM_API_URL);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).pages).toEqual(PAGES);
    expect(print.status()).toBe('done');
    expect(print.progress()).toEqual({ printed: 3, total: 3 });
    expect(print.total()).toBe(3);
  });

  it('se la stampa si ferma dice a quale foglio, e "Riprova" riparte da lì', async () => {
    fetchMock.mockResolvedValueOnce(ndjson([
      { type: 'prepared', total: 3 },
      { type: 'page', page: 1, total: 3 },
      { type: 'error', message: 'Stampante spenta', page: 2 }
    ]));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    askForm();

    await print.confirm();
    expect(print.status()).toBe('error');
    expect(print.stoppedAt()).toBe(2);

    fetchMock.mockResolvedValueOnce(ndjson([
      { type: 'prepared', total: 2 },
      { type: 'page', page: 1, total: 2 },
      { type: 'page', page: 2, total: 2 },
      { type: 'done', total: 2 }
    ]));
    await print.retry();

    expect(JSON.parse(fetchMock.mock.calls[1][1].body).pages).toEqual(PAGES.slice(1));
    expect(print.status()).toBe('done');
    expect(print.progress()).toEqual({ printed: 3, total: 3 });
  });

  it('con un backend senza avanzamento stampa tutto insieme, senza numeri', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === PRINT_STREAM_API_URL ? new Response('', { status: 404 }) : new Response('{"printed": true}')
    );
    askForm();

    await print.confirm();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([PRINT_STREAM_API_URL, PRINT_API_URL]);
    expect(print.status()).toBe('done');
    expect(print.progress()).toBeNull();
  });

  it('dopo una stampa riuscita il dialogo si chiude da solo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockResolvedValue(ndjson([{ type: 'done', total: 3 }]));
    askForm();

    await print.confirm();
    expect(print.job()).not.toBeNull();
    vi.advanceTimersByTime(5000);

    expect(print.job()).toBeNull();
  });
});
