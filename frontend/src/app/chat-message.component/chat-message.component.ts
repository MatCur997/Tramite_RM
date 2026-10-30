import { Component, computed, inject, input } from '@angular/core';
import { AppStateService, ChatMessage } from '../app-state.service';
import { LinkViewerService, ViewerLink } from '../link-viewer.service';
import { SpeechService } from '../speech.service';

/** The citations of an answer, as the backend writes them: [1], [1, 3], also with CJK brackets and commas. */
const CITATION = /[[【［]\s*(\d+(?:\s*[,،，、;]\s*\d+)*)\s*[\]】］]/g;

export type TextPart = { text: string } | { cites: number[] };

/** The text of an answer in pieces: plain text, and the source numbers to show as badges. */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ cites: match[1].split(/[,،，、;]/).map((n) => Number(n.trim())) });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * One message of the chat: the citizen's question in a blue bubble at the end, or the assistant's
 * answer in a white box with its avatar, the keys that read it aloud, its forms and its sources.
 */
@Component({
  selector: 'app-chat-message',
  standalone: true,
  templateUrl: './chat-message.component.html',
  styleUrls: ['./chat-message.component.css']
})
export class ChatMessageView {
  public state = inject(AppStateService);
  public speech = inject(SpeechService);
  private viewer = inject(LinkViewerService);

  readonly message = input.required<ChatMessage>();
  /** The reading keys: for finished answers, in the languages the backend can read. */
  readonly reading = input(false);

  readonly parts = computed(() => textParts(this.message().text));

  hasText(part: TextPart): part is { text: string } {
    return 'text' in part;
  }

  // Files and sources open next to the chat, not in another tab.
  openLink(event: Event, link: ViewerLink): void {
    event.preventDefault();
    this.viewer.open(link);
  }

  /** Play/pause: reads the answer aloud, pauses it, or resumes it where it was paused. */
  togglePlay(): void {
    if (this.speaking()) {
      this.speech.pause();
    } else {
      this.speech.play(this.message().text, this.state.selectedLanguage(), this.message());
    }
  }

  /** "Ricomincia": reads the answer again from its beginning. */
  restartReading(): void {
    this.speech.restart(this.message().text, this.state.selectedLanguage(), this.message());
  }

  speaking(): boolean {
    return this.speech.speaking() === this.message();
  }

  playLabel(): string {
    if (this.speaking()) return this.state.t('pause');
    if (this.speech.paused() === this.message()) return this.state.t('resume');
    return this.state.t('readAloud');
  }
}
