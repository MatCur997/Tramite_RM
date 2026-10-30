import { Component, inject } from '@angular/core';
import { TopicsService, topicIcon } from './topics';

/** At the end of the chat header, one chip per subject of the conversation: the current one in full blue. */
@Component({
  selector: 'app-topic-chips',
  standalone: true,
  template: `
    @if (topics.sections().length) {
      <ul class="chips">
        @for (section of topics.sections(); track section.topic) {
          <li>
            <button type="button" class="chip" [class.current]="section.topic === topics.current()"
                    [class.viewed]="section.topic === topics.viewed()"
                    [attr.aria-current]="section.topic === topics.current() ? 'true' : null"
                    (click)="topics.view(section.topic)">
              <i class="fa-solid {{ icon(section.topic) }}" aria-hidden="true"></i>
              <span>{{ topics.title(section.topic) }}</span>
            </button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .chips {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 52px;
      padding: 0 18px;
      border: 2px solid var(--c-primary);
      border-radius: 999px;
      background: var(--c-surface);
      color: var(--c-primary);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .chip.current {
      background: var(--c-primary);
      color: var(--c-on-primary);
    }
    .chip.viewed {
      outline: 3px solid var(--c-focus);
      outline-offset: 2px;
    }
  `
})
export class TopicChips {
  public topics = inject(TopicsService);

  icon(topic: string): string {
    return topicIcon(topic);
  }
}
