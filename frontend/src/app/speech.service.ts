import { Injectable, NgZone, inject, signal } from '@angular/core';
import { TRANSCRIBE_API_URL, TTS_API_URL, TTS_LANGUAGES_API_URL } from './api.config';

/** Give up on a sentence the backend has not synthesised in this long (it takes well under a second). */
const TTS_TIMEOUT_MS = 20_000;

/** Text without the parts that should not be read aloud: source numbers, Markdown marks, links. */
export function speakableText(text: string): string {
  return text
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Sentence ends: Latin, Arabic (؟ ؛ ۔) and Bengali (।) marks need a space after them (not "22.21"
// or "roma.it"), Chinese ones do not. Commas, ، included, do not end a sentence.
const SENTENCE_END = /(?<=[。！？；])|(?<=[.!?;:…؟؛۔।])\s+/;

/**
 * Splits text into its lines and sentences, of at most ~200 characters: the first one is heard
 * while the backend synthesises the next.
 */
export function speechChunks(text: string, max = 200): string[] {
  const sentences = text
    .split(/\n+/)
    .flatMap((line) => line.split(SENTENCE_END))
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= max) {
      chunks.push(sentence);
      continue;
    }
    let rest = sentence;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max);
      if (cut < max / 2) cut = max;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push(rest);
  }
  return chunks;
}

/** Below this loudness (RMS, 0-1) the microphone hears silence. */
const SILENCE_LEVEL = 0.015;
/** After the person has spoken, this much silence ends the recording, as phone keyboards do. */
const SILENCE_MS = 1500;
/** Nobody speaks at all: the microphone turns off. */
const NO_SPEECH_MS = 7000;
const MAX_MS = 30000;

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  audio: AudioContext;
  timer: ReturnType<typeof setInterval>;
  spoke: boolean;
  send: boolean;
}

/** A message being read aloud: its sentences, their audio once synthesised, the one playing. */
interface Reading {
  key: unknown;
  lang: string;
  chunks: string[];
  /** Object URLs of the sentences' audio; null for a sentence with nothing to read. */
  clips: Promise<string | null>[];
  /** The sentence playing, or paused; null between two sentences. */
  audio: HTMLAudioElement | null;
  abort: AbortController;
}

/**
 * Dictation (speech to text, like the microphone key of phone keyboards) and reading the
 * assistant's answers aloud. Both happen on this computer, in the kiosk's language: nothing goes
 * to Google or other online services, and they work without internet.
 *
 * Dictation: the browser only records the microphone; the recording is transcribed by the
 * kiosk's backend (faster-whisper).
 *
 * Reading aloud: the backend synthesises the answer one sentence at a time with an offline voice
 * for each language (sherpa-onnx), and the browser plays the sentences in order. Windows and Chrome
 * have no voice for Ukrainian, Bengali, Filipino and Arabic.
 */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  private zone = inject(NgZone);

  readonly canDictate =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  readonly canSpeak = typeof Audio !== 'undefined';

  readonly listening = signal(false);
  readonly transcribing = signal(false);
  /** The message that is being read aloud, or null. */
  readonly speaking = signal<unknown>(null);
  /** The message whose reading is paused (play resumes it from there), or null. */
  readonly paused = signal<unknown>(null);
  /** The languages the backend has a voice for; null until it says (or if it cannot say). */
  readonly voiceLanguages = signal<string[] | null>(null);

  private recording: Recording | null = null;
  private reading: Reading | null = null;
  private languagesAsked = false;

  /** Asks the backend, once, which languages it can read aloud. */
  loadVoiceLanguages(): void {
    if (this.languagesAsked || !this.canSpeak) return;
    this.languagesAsked = true;
    void (async () => {
      try {
        const response = await fetch(TTS_LANGUAGES_API_URL);
        // A backend without the list: every language is tried, and a failed reading only stops.
        const body = response.ok ? await response.json() : null;
        if (Array.isArray(body?.languages)) this.voiceLanguages.set(body.languages);
      } catch {
        this.languagesAsked = false; // the backend is not up yet: asked again when the chat opens
      }
    })();
  }

  /** Whether the answers can be read aloud in lang: the reading keys are shown only then. */
  canRead(lang: string | null): boolean {
    const languages = this.voiceLanguages();
    return this.canSpeak && (languages === null || languages.includes(lang ?? 'it'));
  }

  /**
   * Records until the person stops speaking (or stopDictation), then sends the recording to the
   * backend. onText receives the words recognised; onEnd is called at the end, with an error
   * code when it failed.
   */
  async dictate(lang: string | null, onText: (text: string) => void, onEnd: (error?: string) => void): Promise<void> {
    if (!this.canDictate) {
      onEnd('not-supported');
      return;
    }
    this.abortDictation();
    this.stopSpeaking();
    this.listening.set(true);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (err) {
      console.error('Microfono non disponibile:', err);
      this.listening.set(false);
      onEnd('not-allowed');
      return;
    }
    if (!this.listening()) {
      // Stopped while the browser was opening the microphone.
      stream.getTracks().forEach((track) => track.stop());
      onEnd();
      return;
    }

    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);

    // Loudness of the microphone, to notice when the person has finished speaking.
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const started = performance.now();
    let lastVoice = started;

    const rec: Recording = { recorder, stream, audio, timer: 0 as unknown as ReturnType<typeof setInterval>, spoke: false, send: true };
    rec.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const now = performance.now();
      if (Math.sqrt(sum / samples.length) > SILENCE_LEVEL) {
        rec.spoke = true;
        lastVoice = now;
      }
      const done = rec.spoke ? now - lastVoice > SILENCE_MS : now - started > NO_SPEECH_MS;
      if (done || now - started > MAX_MS) this.zone.run(() => this.stopDictation());
    }, 100);

    recorder.onstop = () =>
      this.zone.run(async () => {
        clearInterval(rec.timer);
        stream.getTracks().forEach((track) => track.stop());
        audio.close().catch(() => undefined);
        if (this.recording === rec) this.recording = null;
        this.listening.set(false);
        if (!rec.send || !rec.spoke || !chunks.length) {
          onEnd();
          return;
        }
        this.transcribing.set(true);
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const response = await fetch(`${TRANSCRIBE_API_URL}?language=${encodeURIComponent(lang ?? 'it')}`, {
            method: 'POST',
            headers: { 'Content-Type': blob.type },
            body: blob
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const text = String((await response.json()).text ?? '').trim();
          if (text) onText(text);
          onEnd();
        } catch (err) {
          console.error('Trascrizione non riuscita:', err);
          onEnd('transcription-failed');
        } finally {
          this.transcribing.set(false);
        }
      });

    this.recording = rec;
    recorder.start(250);
  }

  /** Stops listening; what was said is transcribed. */
  stopDictation(): void {
    const rec = this.recording;
    if (rec) {
      if (rec.recorder.state !== 'inactive') rec.recorder.stop();
    } else {
      this.listening.set(false);
    }
  }

  /** Stops listening and throws the recording away. */
  private abortDictation(): void {
    if (this.recording) this.recording.send = false;
    this.stopDictation();
  }

  /**
   * Reads a message aloud, or resumes it where it was paused. key identifies the message (for the
   * state of its buttons): another message starts from its beginning.
   */
  play(text: string, lang: string | null, key: unknown): void {
    if (!this.canSpeak) return;
    const reading = this.reading;
    if (reading && reading.key === key && this.paused() === key) {
      this.paused.set(null);
      this.speaking.set(key);
      // Between two sentences there is nothing to resume: the next one starts when it is ready.
      reading.audio?.play().catch((err) => this.fail(reading, err));
      return;
    }
    this.start(text, lang, key);
  }

  /** Reads the message again from its beginning. */
  restart(text: string, lang: string | null, key: unknown): void {
    if (!this.canSpeak) return;
    this.start(text, lang, key);
  }

  /** Pauses the reading: play() resumes it where it stopped. */
  pause(): void {
    const reading = this.reading;
    if (!reading || this.speaking() !== reading.key) return;
    reading.audio?.pause();
    this.paused.set(reading.key);
    this.speaking.set(null);
  }

  stopSpeaking(): void {
    const reading = this.reading;
    this.reading = null;
    if (reading) {
      reading.abort.abort();
      reading.audio?.pause();
      for (const clip of reading.clips) {
        clip.then((url) => url && URL.revokeObjectURL(url), () => undefined);
      }
    }
    this.speaking.set(null);
    this.paused.set(null);
  }

  stopAll(): void {
    this.abortDictation();
    this.stopSpeaking();
  }

  private start(text: string, lang: string | null, key: unknown): void {
    this.stopSpeaking();
    const chunks = speechChunks(speakableText(text));
    if (!chunks.length) return;
    const reading: Reading = { key, lang: lang ?? 'it', chunks, clips: [], audio: null, abort: new AbortController() };
    this.reading = reading;
    this.speaking.set(key);
    void this.read(reading);
  }

  /** Plays the sentences in order; the next one is synthesised while one plays, so there is no gap. */
  private async read(reading: Reading): Promise<void> {
    try {
      for (let i = 0; i < reading.chunks.length; i++) {
        const url = await this.clip(reading, i);
        void this.clip(reading, i + 1);
        if (this.reading !== reading) return;
        if (url) await this.playClip(reading, url);
        if (this.reading !== reading) return;
      }
      // Finished: the next play starts from the beginning.
      this.stopSpeaking();
    } catch (err) {
      this.fail(reading, err);
    }
  }

  /** The audio of a sentence, asked to the backend once per reading. */
  private clip(reading: Reading, i: number): Promise<string | null> {
    if (i >= reading.chunks.length) return Promise.resolve(null);
    if (!reading.clips[i]) {
      reading.clips[i] = synthesize(reading.chunks[i], reading.lang, reading.abort.signal);
      reading.clips[i].catch(() => undefined); // its error, if any, is handled when it is awaited
    }
    return reading.clips[i];
  }

  private playClip(reading: Reading, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      reading.audio = audio;
      audio.onended = () => {
        reading.audio = null;
        resolve();
      };
      audio.onerror = () => reject(new Error('Audio non riproducibile'));
      reading.abort.signal.addEventListener('abort', () => resolve(), { once: true });
      // Paused while this sentence was being synthesised: it starts when play is touched again.
      if (this.paused() !== reading.key) audio.play().catch(reject);
    });
  }

  /** The answer simply stays written: the play key comes back. */
  private fail(reading: Reading, err: unknown): void {
    if (this.reading !== reading) return;
    console.error('Lettura ad alta voce non riuscita:', err);
    this.stopSpeaking();
  }
}

/** A sentence read aloud by the backend's offline voice, as an object URL; null if there was nothing to read. */
async function synthesize(text: string, lang: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(TTS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language: lang }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TTS_TIMEOUT_MS)])
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return URL.createObjectURL(await response.blob());
}
