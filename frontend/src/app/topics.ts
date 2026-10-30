import { Injectable, computed, inject, signal } from '@angular/core';
import { AppStateService, ChatForm, ChatMessage, ChatSource } from './app-state.service';

/**
 * The subjects of the registry office documents, as the backend tags them (backend/data/sources.json),
 * with their icon. Their names are the translations "topic.<id>".
 */
export const TOPIC_ICONS: Record<string, string> = {
  cie: 'fa-id-card',
  residenza: 'fa-house',
  stranieri: 'fa-earth-europe',
  certificati: 'fa-file-lines',
  autocertificazione: 'fa-file-signature',
  estero: 'fa-plane',
  'stato-civile': 'fa-ring'
};

/** The subjects offered before the first question, in the order of their 3 x 2 grid. */
export const START_TOPICS = ['cie', 'residenza', 'certificati', 'stranieri', 'autocertificazione', 'estero'];

export function topicIcon(topic: string): string {
  return TOPIC_ICONS[topic] ?? 'fa-comments';
}

/** A separator before a question: its answer opens a subject, the first one or a new one. */
export interface TopicMark {
  /** Index of the question in the messages. */
  index: number;
  topic: string;
  first: boolean;
}

/** What the conversation has said about one subject. */
export interface TopicSection {
  topic: string;
  /** The question where the subject started the last time: the chat scrolls back to it. */
  start: number;
  /** Indexes of the questions and answers about it, in order. */
  messages: number[];
  bring: string[];
  forms: ChatForm[];
  sources: ChatSource[];
}

/**
 * Where the subject of the conversation changes: before the question whose answer has another
 * topic than the last one. Answers without a topic (greetings, other subjects) change nothing.
 */
export function topicMarks(messages: ChatMessage[]): TopicMark[] {
  const marks: TopicMark[] = [];
  let last: string | null = null;
  messages.forEach((message, i) => {
    const answer = messages[i + 1];
    if (message.sender !== 'user' || answer?.sender !== 'bot' || !answer.topic || answer.topic === last) return;
    marks.push({ index: i, topic: answer.topic, first: last === null });
    last = answer.topic;
  });
  return marks;
}

/**
 * The subjects of the conversation, in the order they came up, each with its questions and
 * answers (those without a topic go with the subject in course) and, without repetitions, what
 * to bring, the forms and the sources of its answers.
 */
export function topicSections(messages: ChatMessage[]): TopicSection[] {
  const sections = new Map<string, TopicSection>();
  const starts = new Map(topicMarks(messages).map((mark) => [mark.index, mark.topic]));
  let current: string | null = null;
  messages.forEach((message, i) => {
    if (message.sender !== 'user') return;
    const answer = messages[i + 1]?.sender === 'bot' ? messages[i + 1] : undefined;
    current = starts.get(i) ?? current;
    if (!current) return;
    let section = sections.get(current);
    if (!section) {
      section = { topic: current, start: i, messages: [], bring: [], forms: [], sources: [] };
      sections.set(current, section);
    }
    if (starts.has(i)) section.start = i;
    section.messages.push(i);
    if (!answer) return;
    section.messages.push(i + 1);
    for (const item of answer.bring ?? []) {
      if (!section.bring.some((b) => b.toLocaleLowerCase() === item.toLocaleLowerCase())) section.bring.push(item);
    }
    for (const form of answer.forms ?? []) {
      if (!section.forms.some((f) => f.id === form.id)) section.forms.push(form);
    }
    for (const source of answer.sources ?? []) {
      const key = source.url ?? source.title;
      if (!section.sources.some((s) => (s.url ?? s.title) === key)) section.sources.push(source);
    }
  });
  return [...sections.values()];
}

/** The subjects of the current conversation, and the one the citizen went back to, if any. */
@Injectable({ providedIn: 'root' })
export class TopicsService {
  private state = inject(AppStateService);

  readonly marks = computed(() => topicMarks(this.state.chatMessages()));
  readonly sections = computed(() => topicSections(this.state.chatMessages()));
  /** The subject of the last answer that had one. */
  readonly current = computed(() => this.marks().at(-1)?.topic ?? null);
  /** A previous subject the citizen went back to (a chip, a row of the summary); null otherwise. */
  readonly viewed = signal<string | null>(null);
  /** The subject open in the summary: the one gone back to, or the current one. */
  readonly open = computed(() => {
    const viewed = this.viewed();
    return viewed && this.sections().some((s) => s.topic === viewed) ? viewed : this.current();
  });

  title(topic: string, lang?: string | null): string {
    return lang === undefined ? this.state.t(`topic.${topic}`) : this.state.t(`topic.${topic}`, lang);
  }

  /** Goes back to a subject; the current one is simply the end of the conversation. */
  view(topic: string): void {
    this.viewed.set(topic === this.current() ? null : topic);
  }
}
