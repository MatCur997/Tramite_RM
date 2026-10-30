import { Component, inject } from '@angular/core';
import { AppStateService } from './app-state.service';
import { PrintDoc, PrintGroup, PrintService } from './print.service';
import { TopicsService, topicIcon } from './topics';

/** The list of the print dialog: the documents of each subject, with a thumbnail and a big tick. */
@Component({
  selector: 'app-print-docs',
  standalone: true,
  template: `
    @for (group of print.groups(); track $index) {
      <section class="group">
        <h3>
          @if (group.topic) {
            <i class="fa-solid {{ icon(group.topic) }}" aria-hidden="true"></i>
            <span>{{ topics.title(group.topic) }}</span>
          } @else {
            <span>{{ heading(group) }}</span>
          }
        </h3>
        <ul>
          @for (doc of group.docs; track doc.key) {
            <li class="doc" [class.off]="!doc.selected">
              <label class="pick">
                <input type="checkbox" [checked]="doc.selected" [disabled]="doc.state === 'error'" (change)="print.toggle(doc)" />
                <span class="box" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
                <span class="thumb" aria-hidden="true">
                  @switch (doc.state) {
                    @case ('ready') { <img [src]="doc.pages[0]" alt="" /> }
                    @case ('loading') { <i class="fa-solid fa-spinner fa-spin"></i> }
                    @default { <i class="fa-solid fa-file-circle-xmark"></i> }
                  }
                </span>
                <span class="info">
                  <span class="title">{{ doc.title }}</span>
                  <span class="meta" [attr.role]="doc.state === 'loading' ? 'status' : null">{{ meta(doc) }}</span>
                </span>
              </label>
              @if (doc.state === 'ready') {
                <button type="button" class="view" (click)="print.showPreview(doc)">
                  <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                  <span>{{ state.t('printView') }}</span>
                </button>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 18px;
      max-height: 46dvh;
      overflow-y: auto;
      scrollbar-width: thin;
      text-align: start;
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 10px;
      font-size: 1.1rem;
      font-weight: 800;
      color: var(--c-text-strong, inherit);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .doc {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border-radius: 16px;
      border: 2px solid var(--c-primary, #1750c8);
      background: color-mix(in srgb, var(--c-primary, #1750c8) 6%, var(--c-surface, #fff));
    }
    .doc.off {
      border-color: var(--c-border, #ccd);
      background: var(--c-surface, #fff);
    }
    .pick {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 14px;
      min-height: 60px;
      min-width: 0;
      cursor: pointer;
    }
    .pick input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .box {
      display: grid;
      place-items: center;
      flex: none;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      border: 2px solid var(--c-primary, #1750c8);
      background: var(--c-surface, #fff);
      color: transparent;
    }
    .pick input:checked + .box {
      background: var(--c-primary, #1750c8);
      color: var(--c-on-primary, #fff);
    }
    .pick input:focus-visible + .box {
      outline: 3px solid var(--c-primary, #1750c8);
      outline-offset: 3px;
    }
    .pick input:disabled + .box { opacity: 0.4; }
    .thumb {
      display: grid;
      place-items: center;
      flex: none;
      width: 64px;
      height: 90px;
      border: 1px solid var(--c-border, #ccd);
      background: #fff;
      color: var(--c-muted, #555);
      font-size: 22px;
      overflow: hidden;
    }
    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .title {
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .meta {
      color: var(--c-muted, #555);
      font-size: 0.95rem;
    }
    .view {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex: none;
      min-height: 52px;
      padding: 0 16px;
      border-radius: 14px;
      border: 2px solid var(--c-border-hover, #99a);
      background: var(--c-surface, #fff);
      color: var(--c-text, #111);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
  `
})
export class PrintDocs {
  public state = inject(AppStateService);
  public print = inject(PrintService);
  public topics = inject(TopicsService);

  icon(topic: string): string {
    return topicIcon(topic);
  }

  /** A group without a subject: a form on its own, or the summary of the whole conversation. */
  heading(group: PrintGroup): string {
    return group.docs[0]?.kind === 'form' ? group.docs[0].title : this.state.t('convDocTitle');
  }

  meta(doc: PrintDoc): string {
    if (doc.state === 'error') return this.state.t('printDocError');
    if (doc.state === 'loading') {
      const translating = doc.kind === 'summary' && (this.state.selectedLanguage() ?? 'it') !== 'it';
      return this.state.t(translating ? 'printTranslating' : 'viewerLoading');
    }
    return doc.pages.length === 1 ? this.state.t('printOneSheet') : this.state.t('printSheets', { n: doc.pages.length });
  }
}
