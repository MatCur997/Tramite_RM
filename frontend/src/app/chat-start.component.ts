import { Component, inject, output } from '@angular/core';
import { AppStateService } from './app-state.service';
import { START_TOPICS, topicIcon } from './topics';

/** Before the first question: a greeting and the subjects to start from, in a 3 x 2 grid. */
@Component({
  selector: 'app-chat-start',
  standalone: true,
  template: `
    <h2 class="greeting">{{ state.t('startGreeting') }}</h2>
    <p class="hint">{{ state.t('startHint') }}</p>
    <div class="grid">
      @for (topic of startTopics; track topic) {
        <button type="button" class="card" (click)="pick.emit(topic)">
          <span class="icon" aria-hidden="true"><i class="fa-solid {{ icon(topic) }}"></i></span>
          <span class="title">{{ state.t('topic.' + topic) }}</span>
          <span class="desc">{{ state.t('topicDesc.' + topic) }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .greeting {
      margin: 0;
      color: var(--c-text-strong);
      font-size: 2.25rem;
      font-weight: 800;
      line-height: 1.15;
      text-align: center;
    }
    .hint {
      margin: 8px 0 22px;
      color: var(--c-muted);
      font-size: 1.2rem;
      text-align: center;
    }
    /* The cards take 85% of the width of the conversation, and what is in them is sized to
       match, so they do not crowd the screen. */
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      width: 85%;
      margin-inline: auto;
    }
    /* White on the light blue of the conversation, like the answers. */
    .card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 5px;
      min-height: 112px;
      padding: 15px 17px;
      border: 2px solid var(--c-panel-line);
      border-radius: 17px;
      background: var(--c-surface);
      color: var(--c-text);
      font: inherit;
      text-align: start;
      cursor: pointer;
      transition: border-color 0.15s ease, transform 0.15s ease;
    }
    .card:hover {
      border-color: var(--c-primary);
      transform: translateY(-1px);
    }
    .icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      margin-bottom: 3px;
      border-radius: 12px;
      background: var(--c-primary);
      color: var(--c-on-primary);
      font-size: 20px;
    }
    .title {
      font-size: 1.06rem;
      font-weight: 800;
      color: var(--c-text-strong);
      hyphens: auto;
      overflow-wrap: anywhere;
    }
    .desc {
      color: var(--c-muted);
      font-size: 0.85rem;
      line-height: 1.35;
    }
    /* A narrow conversation (a document open beside it), or large text: two columns. */
    @container (max-width: 640px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    :host-context(:is([data-fs="150"], [data-fs="175"], [data-fs="200"])) .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `
})
export class ChatStart {
  public state = inject(AppStateService);
  readonly startTopics = START_TOPICS;
  readonly pick = output<string>();

  icon(topic: string): string {
    return topicIcon(topic);
  }
}
