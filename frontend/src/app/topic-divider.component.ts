import { Component, input } from '@angular/core';

/** Before a question whose answer opens a subject: "Argomento: …" or "Nuovo argomento: …". */
@Component({
  selector: 'app-topic-divider',
  standalone: true,
  template: `
    <span class="line" aria-hidden="true"></span>
    <h2 class="chip"><i class="fa-solid {{ icon() }}" aria-hidden="true"></i><span>{{ label() }}</span></h2>
    <span class="line" aria-hidden="true"></span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 6px 0;
      scroll-margin-top: 12px;
    }
    .line {
      flex: 1;
      height: 2px;
      background: var(--c-line);
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 6px 16px;
      border: 2px solid var(--c-primary);
      border-radius: 999px;
      background: var(--c-surface);
      color: var(--c-primary);
      font-size: 1rem;
      font-weight: 800;
    }
    :host(.viewed) .chip {
      background: var(--c-primary);
      color: var(--c-on-primary);
    }
  `
})
export class TopicDivider {
  readonly label = input.required<string>();
  readonly icon = input.required<string>();
}
