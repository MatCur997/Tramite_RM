import { Component, ElementRef, HostListener, effect, inject, viewChild } from '@angular/core';
import { AppStateService } from './app-state.service';
import { SessionService } from './session.service';

/** "Vuoi chiudere e cancellare la conversazione?", in the style of the print dialog. */
@Component({
  selector: 'app-end-dialog',
  standalone: true,
  template: `
    @if (session.confirmingEnd()) {
      <div class="ed-backdrop" (click)="cancel()">
        <section #card class="ed-card" role="alertdialog" aria-modal="true" aria-labelledby="ed-title" tabindex="-1"
                 [attr.dir]="state.dir()" [attr.lang]="state.selectedLanguage() ?? 'it'" (click)="$event.stopPropagation()">
          <span class="ed-icon" aria-hidden="true"><i class="fa-solid fa-xmark"></i></span>
          <h2 id="ed-title">{{ state.t('endTitle') }}</h2>
          <div class="ed-actions">
            <button type="button" class="ed-btn ed-secondary" (click)="cancel()">{{ state.t('btnCancel') }}</button>
            <button type="button" class="ed-btn ed-primary" (click)="session.end()">
              <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
              <span>{{ state.t('endConfirm') }}</span>
            </button>
          </div>
        </section>
      </div>
    }
  `,
  styles: `
    .ed-backdrop {
      position: fixed;
      inset: 0;
      z-index: 3000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(4, 12, 30, 0.62);
      animation: ed-fade 0.15s ease;
    }
    .ed-card {
      box-sizing: border-box;
      width: min(600px, 100%);
      max-height: calc(100dvh - 48px);
      overflow-y: auto;
      padding: 32px 32px 28px;
      border-radius: 24px;
      background: var(--c-surface, #fff);
      color: var(--c-text, #111);
      border: var(--border-w, 1px) solid var(--c-border, #ccd);
      box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.6);
      text-align: center;
      animation: ed-rise 0.2s cubic-bezier(0.2, 0.75, 0.2, 1);
    }
    .ed-card:focus { outline: none; }
    .ed-icon {
      display: inline-grid;
      place-items: center;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      border: 3px solid #cd212a;
      color: #cd212a;
      font-size: 32px;
    }
    h2 {
      margin: 18px 0 8px;
      font-size: 1.45rem;
      font-weight: 800;
      color: var(--c-text-strong, inherit);
    }
    .ed-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 22px;
    }
    .ed-btn {
      flex: 1 1 200px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 64px;
      padding: 0 20px;
      border-radius: 16px;
      font: inherit;
      font-size: 1.1rem;
      font-weight: 700;
      cursor: pointer;
    }
    .ed-primary {
      border: 2px solid #cd212a;
      background: #cd212a;
      color: #ffffff;
    }
    .ed-primary:hover { background: #a51a22; }
    .ed-secondary {
      border: 2px solid var(--c-border-hover, #99a);
      background: var(--c-surface, #fff);
      color: var(--c-text, #111);
    }
    :host-context([data-cvd="contrast"]) .ed-primary {
      border-color: #ffffff;
      background: #000000;
    }
    @keyframes ed-fade { from { opacity: 0; } }
    @keyframes ed-rise { from { opacity: 0; transform: translateY(16px); } }
    @media (prefers-reduced-motion: reduce) {
      .ed-backdrop, .ed-card { animation: none; }
    }
  `
})
export class EndDialog {
  public state = inject(AppStateService);
  public session = inject(SessionService);
  private card = viewChild<ElementRef<HTMLElement>>('card');

  constructor() {
    // The focus goes into the dialog, so that screen readers read the question.
    effect(() => {
      if (this.session.confirmingEnd()) setTimeout(() => this.card()?.nativeElement.focus());
    });
  }

  cancel(): void {
    this.session.confirmingEnd.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.session.confirmingEnd()) this.cancel();
  }
}
