import { Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { AppStateService } from './app-state.service';
import { IDLE_WARNING_SECONDS, SessionService } from './session.service';

/** "Are you still there?", over everything, in the last seconds before an inactive session ends. */
@Component({
  selector: 'app-idle-warning',
  standalone: true,
  template: `
    @if (session.secondsLeft(); as seconds) {
      <!-- A touch anywhere keeps the session; only "Fine" ends it at once. -->
      <div class="iw-backdrop" (click)="session.touch()">
        <section #card class="iw-card" role="alertdialog" aria-modal="true" aria-labelledby="iw-title" aria-describedby="iw-message"
                 tabindex="-1" [attr.dir]="state.dir()" [attr.lang]="state.selectedLanguage() ?? 'it'">
          <span class="iw-icon" aria-hidden="true"><i class="fa-solid fa-hourglass-half"></i></span>
          <h2 id="iw-title">{{ state.t('idleTitle') }}</h2>
          <p id="iw-message" class="iw-message">{{ state.t('idleMessage') }}</p>
          <p class="iw-countdown" aria-live="polite" aria-atomic="true">
            <span class="iw-seconds">{{ seconds }}</span>
            <span>{{ state.t('idleSeconds') }}</span>
          </p>
          <div class="iw-bar" aria-hidden="true"><div class="iw-fill" [style.width.%]="progress()"></div></div>

          <div class="iw-actions">
            <button type="button" class="iw-btn iw-secondary" (click)="end($event)">
              <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>
              <span>{{ state.t('endSession') }}</span>
            </button>
            <button type="button" class="iw-btn iw-primary">{{ state.t('idleContinue') }}</button>
          </div>
        </section>
      </div>
    }
  `,
  styles: `
    .iw-backdrop {
      position: fixed;
      inset: 0;
      z-index: 4000; /* above the print dialog and the web app's viewer */
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(4, 12, 30, 0.62);
      animation: iw-fade 0.15s ease;
    }
    .iw-card {
      box-sizing: border-box;
      width: min(560px, 100%);
      padding: 32px 32px 28px;
      border-radius: 24px;
      background: var(--c-surface, #fff);
      color: var(--c-text, #111);
      border: var(--border-w, 1px) solid var(--c-border, #ccd);
      box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.6);
      text-align: center;
      animation: iw-rise 0.2s cubic-bezier(0.2, 0.75, 0.2, 1);
    }
    .iw-card:focus { outline: none; }
    .iw-icon {
      display: inline-grid;
      place-items: center;
      width: 64px;
      height: 64px;
      border-radius: 18px;
      background: var(--c-primary, #1750c8);
      color: var(--c-on-primary, #fff);
      font-size: 28px;
    }
    h2 {
      margin: 18px 0 8px;
      font-size: 1.45rem;
      font-weight: 800;
      color: var(--c-text-strong, inherit);
    }
    .iw-message {
      margin: 0 0 14px;
      color: var(--c-muted, #555);
      font-size: 1.05rem;
      line-height: 1.45;
    }
    .iw-countdown {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 10px;
      margin: 0 0 14px;
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--c-text-strong, inherit);
    }
    .iw-seconds {
      font-size: 3rem;
      font-weight: 800;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      color: var(--c-primary, #1750c8);
    }
    .iw-bar {
      height: 8px;
      margin: 0 0 24px;
      border-radius: 999px;
      background: var(--c-soft, #e6ecf7);
      overflow: hidden;
    }
    .iw-fill {
      height: 100%;
      border-radius: inherit;
      background: var(--c-primary, #1750c8);
      transition: width 1s linear;
    }
    .iw-actions {
      display: flex;
      gap: 14px;
    }
    .iw-btn {
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
    .iw-primary {
      border: 2px solid var(--c-primary, #1750c8);
      background: var(--c-primary, #1750c8);
      color: var(--c-on-primary, #fff);
    }
    .iw-primary:hover { background: var(--c-primary-hover, #1240a0); }
    .iw-secondary {
      border: 2px solid var(--c-border-hover, #99a);
      background: var(--c-surface, #fff);
      color: var(--c-text, #111);
    }
    @keyframes iw-fade { from { opacity: 0; } }
    @keyframes iw-rise { from { opacity: 0; transform: translateY(16px); } }
    @media (prefers-reduced-motion: reduce) {
      .iw-backdrop, .iw-card { animation: none; }
      .iw-fill { transition: none; }
    }
  `
})
export class IdleWarning {
  public state = inject(AppStateService);
  public session = inject(SessionService);
  private card = viewChild<ElementRef<HTMLElement>>('card');

  readonly progress = computed(() => ((this.session.secondsLeft() ?? 0) / IDLE_WARNING_SECONDS) * 100);
  private readonly open = computed(() => this.session.secondsLeft() !== null);

  constructor() {
    // Focus moves into the dialog when it opens (not at every second), for keyboards and screen readers.
    effect(() => {
      if (this.open()) queueMicrotask(() => this.card()?.nativeElement.focus());
    });
  }

  end(event: Event): void {
    event.stopPropagation(); // the tap must not also reach the backdrop, which keeps the session
    this.session.end();
  }
}
