import { Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { AppStateService } from './app-state.service';
import { PrintService } from './print.service';
import { PrintDocs } from './print-docs.component';
import { PrintPreview } from './print-preview.component';

/**
 * "Are you sure you want to print?", over everything, before anything is printed: the documents
 * to choose, then the progress of the print sheet by sheet, its end or where it stopped.
 */
@Component({
  selector: 'app-print-dialog',
  standalone: true,
  imports: [PrintDocs, PrintPreview],
  template: `
    @if (print.job(); as job) {
      <div class="pd-backdrop" (click)="print.cancel()">
        <section #card class="pd-card" [class.pd-wide]="wide()" role="alertdialog" aria-modal="true"
                 aria-labelledby="pd-title" aria-describedby="pd-doc" tabindex="-1"
                 [attr.dir]="state.dir()" [attr.lang]="state.selectedLanguage() ?? 'it'" (click)="$event.stopPropagation()">
          @switch (print.status()) {
            @case ('confirm') {
              <h2 id="pd-title">{{ state.t('printAskTitle') }}</h2>
              <p id="pd-doc" class="pd-doc">{{ hint() }}</p>
              <app-print-docs />
              <ul class="pd-notes">
                @if (topicCount() > 1) {
                  <li><i class="fa-solid fa-layer-group" aria-hidden="true"></i><span>{{ state.t('printNoteTopics') }}</span></li>
                }
                <li><i class="fa-solid fa-print" aria-hidden="true"></i><span>{{ state.t('printNotePrinter') }}</span></li>
              </ul>
              <div class="pd-actions">
                <button type="button" class="pd-btn pd-secondary" (click)="print.cancel()">{{ state.t('btnCancel') }}</button>
                <button type="button" class="pd-btn pd-primary" (click)="print.confirm()" [disabled]="!print.canPrint()">
                  <i class="fa-solid fa-print" aria-hidden="true"></i>
                  <span>{{ print.sheets() === 1 ? state.t('printYesOne') : state.t('printYes', { n: print.sheets() }) }}</span>
                </button>
              </div>
            }
            @case ('preview') {
              <app-print-preview />
              <div class="pd-actions">
                <button type="button" class="pd-btn pd-secondary" (click)="print.backToList()">
                  <i class="fa-solid fa-arrow-left pd-back" aria-hidden="true"></i>
                  <span>{{ state.t('printBackToList') }}</span>
                </button>
              </div>
            }
            @case ('done') {
              <span class="pd-icon pd-ok" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
              <h2 id="pd-title" role="status">{{ doneText() }}</h2>
              <p id="pd-doc" class="pd-doc">{{ job.title }}</p>
              <div class="pd-actions">
                <button type="button" class="pd-btn pd-primary" (click)="print.cancel()">{{ state.t('printOk') }}</button>
              </div>
            }
            @case ('error') {
              <span class="pd-icon" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></span>
              <h2 id="pd-title">{{ stoppedText() ?? state.t('viewerPrintError') }}</h2>
              <p id="pd-doc" class="pd-doc">{{ stoppedText() ? state.t('viewerPrintError') : job.title }}</p>
              <div class="pd-actions">
                <button type="button" class="pd-btn pd-secondary" (click)="print.cancel()">{{ state.t('viewerClose') }}</button>
                <button type="button" class="pd-btn pd-primary" (click)="print.retry()">
                  <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                  <span>{{ state.t('printRetry') }}</span>
                </button>
              </div>
            }
            @default {
              <span class="pd-icon" aria-hidden="true"><i class="fa-solid fa-print"></i></span>
              <h2 id="pd-title" role="status">{{ progressText() }}</h2>
              <p id="pd-doc" class="pd-doc">{{ job.title }}</p>
              @if (print.progress(); as progress) {
                @if (progress.printed !== null) {
                  <progress class="pd-progress" [max]="progress.total" [value]="progress.printed" [attr.aria-label]="progressText()"></progress>
                }
              }
              <!-- Under the text, so that the text stays where the eye already is. -->
              <i class="fa-solid fa-spinner fa-spin pd-spinner" aria-hidden="true"></i>
            }
          }
        </section>
      </div>
    }
  `,
  styles: `
    .pd-backdrop {
      position: fixed;
      inset: 0;
      z-index: 3000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(4, 12, 30, 0.62);
      animation: pd-fade 0.15s ease;
    }
    .pd-card {
      box-sizing: border-box;
      width: min(560px, 100%);
      max-height: calc(100dvh - 48px);
      overflow-y: auto;
      padding: 32px 32px 28px;
      border-radius: 24px;
      background: var(--c-surface, #fff);
      color: var(--c-text, #111);
      border: var(--border-w, 1px) solid var(--c-border, #ccd);
      box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.6);
      text-align: center;
      animation: pd-rise 0.2s cubic-bezier(0.2, 0.75, 0.2, 1);
    }
    .pd-card.pd-wide { width: min(980px, 100%); }
    .pd-card:focus { outline: none; }
    .pd-icon {
      display: inline-grid;
      place-items: center;
      width: 64px;
      height: 64px;
      border-radius: 18px;
      background: var(--c-primary, #1750c8);
      color: var(--c-on-primary, #fff);
      font-size: 28px;
    }
    .pd-ok { background: var(--c-accent, #008c45); }
    h2 {
      margin: 18px 0 8px;
      font-size: 1.45rem;
      font-weight: 800;
      color: var(--c-text-strong, inherit);
    }
    .pd-wide h2 { margin-top: 0; }
    .pd-doc {
      margin: 0 0 22px;
      color: var(--c-muted, #555);
      font-size: 1.05rem;
      overflow-wrap: anywhere;
    }
    .pd-notes {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 18px 0 0;
      padding: 0;
      list-style: none;
      color: var(--c-muted, #555);
      text-align: start;
    }
    .pd-notes li {
      display: flex;
      gap: 10px;
      align-items: baseline;
    }
    .pd-progress {
      width: 100%;
      height: 14px;
      margin: 0 0 20px;
      accent-color: var(--c-primary, #1750c8);
    }
    .pd-spinner {
      display: block;
      margin: 4px auto 0;
      font-size: 48px;
      color: var(--c-primary, #1750c8);
    }
    .pd-actions {
      display: flex;
      gap: 14px;
      margin-top: 22px;
    }
    .pd-btn {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 60px;
      padding: 0 20px;
      border-radius: 16px;
      font: inherit;
      font-size: 1.1rem;
      font-weight: 700;
      cursor: pointer;
    }
    .pd-btn:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .pd-primary {
      border: 2px solid var(--c-primary, #1750c8);
      background: var(--c-primary, #1750c8);
      color: var(--c-on-primary, #fff);
    }
    .pd-primary:hover:not(:disabled) { background: var(--c-primary-hover, #1240a0); }
    .pd-secondary {
      border: 2px solid var(--c-border-hover, #99a);
      background: var(--c-surface, #fff);
      color: var(--c-text, #111);
    }
    [dir="rtl"] .pd-back { transform: scaleX(-1); }
    @keyframes pd-fade { from { opacity: 0; } }
    @keyframes pd-rise { from { opacity: 0; transform: translateY(16px); } }
    @media (prefers-reduced-motion: reduce) {
      .pd-backdrop, .pd-card { animation: none; }
      .pd-spinner { animation: none; }
    }
  `
})
export class PrintDialog {
  public state = inject(AppStateService);
  public print = inject(PrintService);
  private card = viewChild<ElementRef<HTMLElement>>('card');

  readonly wide = computed(() => this.print.status() === 'confirm' || this.print.status() === 'preview');
  readonly topicCount = computed(() => this.print.groups().filter((group) => group.topic).length);

  readonly hint = computed(() =>
    this.topicCount() > 1 ? this.state.t('printTopicsHint', { n: this.topicCount() }) : this.state.t('printHint')
  );

  readonly progressText = computed(() => {
    const progress = this.print.progress();
    if (!progress) return this.state.t('viewerPrinting');
    if (progress.printed === null) return this.state.t('printPreparing');
    return this.state.t('printProgress', { n: progress.printed, totale: progress.total });
  });

  readonly doneText = computed(() => {
    const total = this.print.total();
    return total === 1 ? this.state.t('printDoneOne') : this.state.t('printDone', { totale: total });
  });

  /** "Stopped at sheet 2 of 3", when the backend said where. */
  readonly stoppedText = computed(() => {
    const page = this.print.stoppedAt();
    return page ? this.state.t('printStopped', { n: page, totale: this.print.total() }) : null;
  });

  constructor() {
    // Focus moves into the dialog when it opens, for keyboards and screen readers.
    effect(() => {
      if (this.print.job()) queueMicrotask(() => this.card()?.nativeElement.focus());
    });
  }
}
