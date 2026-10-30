import { Component, ElementRef, HostListener, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppStateService, ChatForm, ChatMessage, ChatSource } from '../app-state.service';
import { CHAT_API_URL } from '../api.config';
import { VirtualKeyboard } from '../virtual-keyboard.component/virtual-keyboard.component';
import { LinkViewer } from '../link-viewer.component/link-viewer.component';
import { LinkViewerService } from '../link-viewer.service';
import { SpeechService } from '../speech.service';
import { PrintService } from '../print.service';
import { SessionService } from '../session.service';
import { TopicsService, topicIcon } from '../topics';
import { TopicDivider } from '../topic-divider.component';
import { TopicChips } from '../topic-chips.component';
import { ChatStart } from '../chat-start.component';
import { SummaryPanel } from '../summary-panel.component/summary-panel.component';
import { TopControls } from '../top-controls.component';
import { ChatMessageView } from '../chat-message.component/chat-message.component';

type StreamEvent =
  | { type: 'token'; text: string }
  // topic: from backends that group answers by subject; older ones do not send it.
  | { type: 'sources'; sources: ChatSource[]; forms: ChatForm[]; topic?: string | null }
  | { type: 'summary'; bring: string[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [FormsModule, TopControls, ChatMessageView, VirtualKeyboard, LinkViewer, TopicDivider, TopicChips, ChatStart, SummaryPanel],
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.css']
})
export class Chatbot implements OnDestroy {
  public state = inject(AppStateService);
  public viewer = inject(LinkViewerService);
  public speech = inject(SpeechService);
  public printer = inject(PrintService);
  public topics = inject(TopicsService);
  private session = inject(SessionService);

  private messagesBox = viewChild<ElementRef<HTMLElement>>('messagesBox');
  private chatInput = viewChild<ElementRef<HTMLInputElement>>('chatInput');

  readonly newMessage = signal('');
  // The session's: the inactivity timer waits for the answer to arrive.
  readonly waiting = this.session.answering;
  readonly keyboardOpen = signal(false);
  /** Shown for a few seconds in the input field when the microphone could not be used. */
  readonly voiceError = signal(false);
  private voiceErrorTimer?: ReturnType<typeof setTimeout>;
  /** Stops the answer being read when the chat closes (back, language, "Fine"). */
  private stream?: AbortController;

  /** The separator before each question whose answer opens a subject, by index of the question. */
  readonly marks = computed(() => new Map(this.topics.marks().map((mark) => [mark.index, mark])));
  /** Before the first question, the subjects to start from are shown. */
  readonly hasQuestions = computed(() => this.state.chatMessages().some((m) => m.sender === 'user'));

  constructor() {
    this.speech.loadVoiceLanguages();
    effect(() => {
      this.state.chatMessages();
      this.waiting();
      // The keyboard and a document make the conversation shorter or narrower: the last message
      // stays in view, once the new layout is drawn.
      this.keyboardOpen();
      this.viewer.link();
      // While the citizen reads an earlier subject, new text does not pull the chat away from it.
      if (this.topics.viewed()) return;
      const box = this.messagesBox()?.nativeElement;
      // Before the first question the greeting and the subjects are read from the top.
      const end = this.hasQuestions();
      if (box) {
        setTimeout(() => box.scrollTop = end ? box.scrollHeight : 0);
      }
    });
    // Back to an earlier subject (a chip, a row of the summary): the chat scrolls to where it started.
    effect(() => {
      const topic = this.topics.viewed();
      if (topic) untracked(() => queueMicrotask(() => this.scrollToTopic(topic)));
    });
  }

  topicLabel(topic: string, first: boolean): string {
    return this.state.t(first ? 'topicFirst' : 'topicNew', { titolo: this.topics.title(topic) });
  }

  topicIcon(topic: string): string {
    return topicIcon(topic);
  }

  /** A subject of the start grid: its first question, in the citizen's language. */
  askAbout(topic: string): void {
    this.newMessage.set(this.state.t(`topicStart.${topic}`));
    void this.sendMessage();
  }

  /** "Torna all'ultima domanda": the end of the conversation again. */
  backToLast(): void {
    this.topics.viewed.set(null);
  }

  private scrollToTopic(topic: string): void {
    const marks = this.messagesBox()?.nativeElement.querySelectorAll<HTMLElement>(`[data-topic-start="${topic}"]`);
    const behavior = matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    marks?.[marks.length - 1]?.scrollIntoView({ block: 'start', behavior });
  }

  closeKeyboard(): void {
    this.keyboardOpen.set(false);
    this.chatInput()?.nativeElement.blur();
  }

  // Only a touch outside the chat, the keyboard and the open file or page closes the keyboard.
  @HostListener('document:pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (!this.keyboardOpen()) return;
    const target = event.target as Element | null;
    if (target?.closest('app-virtual-keyboard, .chatbot-container, app-link-viewer')) return;
    this.closeKeyboard();
  }

  ngOnDestroy(): void {
    this.stream?.abort();
    this.viewer.close();
    this.speech.stopAll();
    this.topics.viewed.set(null);
    clearTimeout(this.voiceErrorTimer);
  }

  /** The text field's hint: what to do, "listening…" while dictating, or why dictation failed. */
  placeholder(): string {
    if (this.voiceError()) return this.state.t('voiceError');
    if (this.speech.listening()) return this.state.t('listening');
    if (this.speech.transcribing()) return this.state.t('transcribing');
    const viewed = this.topics.viewed();
    if (viewed) return this.state.t('askAbout', { argomento: this.topics.title(viewed) });
    return this.state.t('inputPlaceholder');
  }

  /** Microphone key: the words spoken are written in the field, after what is already there. */
  toggleDictation(): void {
    if (this.speech.listening()) {
      this.speech.stopDictation();
      return;
    }
    clearTimeout(this.voiceErrorTimer);
    this.voiceError.set(false);
    const before = this.newMessage().trim();
    this.speech.dictate(
      this.state.selectedLanguage(),
      (heard) => this.newMessage.set(before && heard ? `${before} ${heard}` : before || heard),
      (error) => {
        if (!error) return;
        console.error('Dettatura non riuscita:', error);
        this.voiceError.set(true);
        this.voiceErrorTimer = setTimeout(() => this.voiceError.set(false), 4000);
      }
    );
  }

  /** Summary of the conversation with the Italian translation, after a confirmation. */
  printConversation(): void {
    this.closeKeyboard();
    this.printer.ask({ title: this.state.t('convDocTitle') });
  }

  goBack(): void {
    this.speech.stopAll();
    this.state.currentStep.set('choice');
  }

  goToLanguageSelection(): void {
    this.speech.stopAll();
    this.state.goToLanguage('choice');
  }

  async sendMessage(): Promise<void> {
    const text = this.newMessage().trim();
    if (!text || this.waiting()) return;

    this.closeKeyboard();
    this.speech.stopAll();
    this.topics.viewed.set(null);
    this.state.addMessage({ text, sender: 'user' });
    this.newMessage.set('');
    this.waiting.set(true);

    let reply: ChatMessage = { text: '', sender: 'bot', pending: true };
    this.state.addMessage(reply);

    const payload = {
      message: text,
      language: this.state.selectedLanguage(),
      session_id: this.state.sessionId
    };

    const stream = (this.stream = new AbortController());
    try {
      const response = await fetch(`${CHAT_API_URL}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: stream.signal
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) reply = this.handleEvent(reply, JSON.parse(line));
        }
      }
    } catch (err) {
      // Aborted: the chat has closed, nobody is waiting for this answer any more.
      if (!stream.signal.aborted) {
        console.error('Errore backend Python:', err);
        reply = this.state.updateMessage(reply, { text: this.state.t('chatError') });
      }
    } finally {
      this.state.updateMessage(reply, { pending: false });
      this.waiting.set(false);
    }
  }

  private handleEvent(reply: ChatMessage, event: StreamEvent): ChatMessage {
    if (event.type === 'token') {
      return this.state.updateMessage(reply, { text: reply.text + event.text, pending: false });
    }
    if (event.type === 'sources') {
      return this.state.updateMessage(reply, { sources: event.sources, forms: event.forms, topic: event.topic ?? null });
    }
    if (event.type === 'summary') {
      return this.state.updateMessage(reply, { bring: event.bring });
    }
    if (event.type === 'error') {
      throw new Error(event.message);
    }
    return reply;
  }
}
