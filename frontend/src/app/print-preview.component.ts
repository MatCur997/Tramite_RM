import { Component, computed, inject } from '@angular/core';
import { AppStateService } from './app-state.service';
import { PrintService } from './print.service';

/** A document of the print dialog full size, page by page. */
@Component({
  selector: 'app-print-preview',
  standalone: true,
  template: `
    @if (print.preview(); as doc) {
      <h2 id="pd-title">{{ doc.title }}</h2>
      <p id="pd-doc" class="count" aria-live="polite">{{ state.t('pageOf', { x: page() + 1, y: doc.pages.length }) }}</p>
      <div class="stage">
        <button type="button" class="arrow" (click)="print.turnPage(-1)" [disabled]="page() === 0"
                [attr.aria-label]="state.t('pagePrev')">
          <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
        </button>
        <img class="sheet" [src]="doc.pages[page()]" [alt]="state.t('pageOf', { x: page() + 1, y: doc.pages.length })" draggable="false" />
        <button type="button" class="arrow" (click)="print.turnPage(1)" [disabled]="page() === doc.pages.length - 1"
                [attr.aria-label]="state.t('pageNext')">
          <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    h2 {
      margin: 0 0 4px;
      font-size: 1.3rem;
      font-weight: 800;
      color: var(--c-text-strong, inherit);
      overflow-wrap: anywhere;
    }
    /* Not "page": that is the global class of the screens, with their background. */
    .count {
      margin: 0 0 12px;
      color: var(--c-muted, #555);
      font-weight: 700;
    }
    .stage {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 18px;
    }
    .sheet {
      max-width: min(100%, 62dvh);
      max-height: 62dvh;
      border: 1px solid var(--c-border, #ccd);
      background: #fff;
      box-shadow: 0 10px 30px -14px rgba(0, 0, 0, 0.5);
    }
    .arrow {
      display: grid;
      place-items: center;
      flex: none;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      border: 2px solid var(--c-primary, #1750c8);
      background: var(--c-surface, #fff);
      color: var(--c-primary, #1750c8);
      font-size: 22px;
      cursor: pointer;
    }
    .arrow:disabled {
      opacity: 0.35;
      cursor: default;
    }
    /* In Arabic the previous page is on the right: the arrows point the other way. */
    :host-context([dir="rtl"]) .arrow i { transform: scaleX(-1); }
  `
})
export class PrintPreview {
  public state = inject(AppStateService);
  public print = inject(PrintService);

  readonly page = computed(() => this.print.previewPage());
}
