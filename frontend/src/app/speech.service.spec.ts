import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { TTS_API_URL } from './api.config';
import { SpeechService, speechChunks } from './speech.service';

/** Stand-in for the browser's audio: it "ends" only when the test says so. */
class FakeAudio {
  static all: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  playing = false;
  plays = 0;

  constructor(public src: string) {
    FakeAudio.all.push(this);
  }

  play(): Promise<void> {
    this.playing = true;
    this.plays++;
    return Promise.resolve();
  }

  pause(): void {
    this.playing = false;
  }

  end(): void {
    this.playing = false;
    this.onended?.();
  }
}

describe('speechChunks', () => {
  it('divide il testo in righe e frasi, anche in cinese, arabo e bengalese', () => {
    expect(speechChunks('Porta la foto. Costa 22.21 euro.\n- passaporto')).toEqual([
      'Porta la foto.',
      'Costa 22.21 euro.',
      '- passaporto'
    ]);
    expect(speechChunks('您需要护照。还要照片！')).toEqual(['您需要护照。', '还要照片！']);
    expect(speechChunks('هل لديك جواز؟ نعم.')).toEqual(['هل لديك جواز؟', 'نعم.']);
    expect(speechChunks('পাসপোর্ট আনুন। ছবি আনুন।')).toEqual(['পাসপোর্ট আনুন।', 'ছবি আনুন।']);
    expect(speechChunks('أحضر الجواز؛ والصورة۔ شكراً')).toEqual(['أحضر الجواز؛', 'والصورة۔', 'شكراً']);
    expect(speechChunks('جواز، صورة، ورقة.')).toEqual(['جواز، صورة، ورقة.']); // commas do not end a sentence
  });
});

describe('SpeechService (lettura ad alta voce)', () => {
  let speech: SpeechService;
  let fetchMock: ReturnType<typeof vi.fn>;
  let urls = 0;
  const message = { text: 'risposta' };

  const wav = () => new Response(new Blob(['RIFF']), { status: 200 });
  const sentText = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

  beforeEach(() => {
    FakeAudio.all = [];
    urls = 0;
    fetchMock = vi.fn(async () => wav());
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Audio', FakeAudio);
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++urls}`), revokeObjectURL: vi.fn() });
    speech = TestBed.inject(SpeechService);
  });

  afterEach(() => {
    speech.stopSpeaking();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('legge le frasi una dopo l’altra con la voce del backend, preparando la successiva', async () => {
    speech.play('Prima frase. Seconda frase.', 'uk', message);
    expect(speech.speaking()).toBe(message);

    await vi.waitFor(() => expect(FakeAudio.all[0]?.playing).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe(TTS_API_URL);
    expect(sentText(0)).toEqual({ text: 'Prima frase.', language: 'uk' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentText(1)).toEqual({ text: 'Seconda frase.', language: 'uk' });

    FakeAudio.all[0].end();
    await vi.waitFor(() => expect(FakeAudio.all[1]?.playing).toBe(true));
    FakeAudio.all[1].end();
    await vi.waitFor(() => expect(speech.speaking()).toBeNull());
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('la pausa ferma la frase e play la riprende dallo stesso punto', async () => {
    speech.play('Una frase sola.', 'it', message);
    await vi.waitFor(() => expect(FakeAudio.all[0]?.playing).toBe(true));

    speech.pause();
    expect(FakeAudio.all[0].playing).toBe(false);
    expect(speech.paused()).toBe(message);
    expect(speech.speaking()).toBeNull();

    speech.play('Una frase sola.', 'it', message);
    expect(FakeAudio.all.length).toBe(1);
    expect(FakeAudio.all[0].plays).toBe(2);
    expect(speech.speaking()).toBe(message);
  });

  it('una frase senza nulla da leggere viene saltata', async () => {
    // Only a citation: the backend finds nothing to read in it (204).
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 }));
    speech.play('【1】\nSeconda frase.', 'zh', message);

    await vi.waitFor(() => expect(FakeAudio.all[0]?.playing).toBe(true));
    expect(FakeAudio.all.length).toBe(1);
    expect(sentText(1).text).toBe('Seconda frase.');
  });

  it('se la sintesi non riesce la risposta resta scritta e torna il tasto play', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
    speech.play('Una frase.', 'bn', message);

    await vi.waitFor(() => expect(speech.speaking()).toBeNull());
    expect(FakeAudio.all.length).toBe(0);
  });

  it('mostra la lettura solo nelle lingue che il backend sa leggere', async () => {
    expect(speech.canRead('bn')).toBe(true); // until the backend says, every language is tried

    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ languages: ['it', 'ar'] })));
    speech.loadVoiceLanguages();
    await vi.waitFor(() => expect(speech.voiceLanguages()).toEqual(['it', 'ar']));

    expect(speech.canRead('ar')).toBe(true);
    expect(speech.canRead(null)).toBe(true); // Italian
    expect(speech.canRead('bn')).toBe(false);
  });

  it('stopSpeaking interrompe la lettura', async () => {
    speech.play('Una frase. Un’altra.', 'ar', message);
    await vi.waitFor(() => expect(FakeAudio.all[0]?.playing).toBe(true));

    speech.stopSpeaking();
    expect(FakeAudio.all[0].playing).toBe(false);
    expect(speech.speaking()).toBeNull();
    expect(speech.paused()).toBeNull();
  });
});
