import { Component, inject, input, output } from '@angular/core';
import { AppStateService } from './app-state.service';
import { SessionService } from './session.service';
import { Accessibility } from './accessibility.component/accessibility.component';

/**
 * The row at the top of every screen, straight on the blue background, with no bar behind it:
 * "Indietro" and the Tramite logo at the start (not on the welcome screen, whose logo is in the
 * middle), and at the end, always in this order, accessibility, language and, in the chat, the key
 * that ends the conversation. In Arabic the row is mirrored.
 */
@Component({
  selector: 'app-top-controls',
  standalone: true,
  imports: [Accessibility],
  // On the welcome screen a touch anywhere starts: not a touch on these keys.
  host: { '(click)': '$event.stopPropagation()' },
  template: `
    <div class="tc" [attr.dir]="state.dir()" [attr.lang]="state.selectedLanguage() ?? 'it'">
      @if (withBack()) {
        <div class="tc-start">
          <button type="button" class="action-btn back-btn" (click)="back.emit()">
            <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
            <span>{{ state.t('back') }}</span>
          </button>
          <img class="tc-logo" src="logo-tramite-wordmark-negativo.png" alt="Tramite" />
        </div>
      }
      <div class="tc-end">
        <app-accessibility />
        <button type="button" class="lang-switch" [class.current]="languageCurrent()"
                [attr.aria-current]="languageCurrent() ? 'page' : null"
                [attr.aria-label]="state.t('changeLang')" [title]="state.t('changeLang')" (click)="language.emit()">
          <span class="tc-icon" aria-hidden="true"><i class="fa-solid fa-globe"></i></span>
        </button>
        @if (endable()) {
          <button type="button" class="end-btn" [attr.aria-label]="state.t('endLabel')" [title]="state.t('endLabel')"
                  (click)="session.askEnd()">
            <span class="tc-icon" aria-hidden="true"><i class="fa-solid fa-xmark"></i></span>
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      position: relative;
      z-index: 20; /* the accessibility panel opens over the screen below */
      display: block;
      flex: none;
    }
    .tc {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 22px 40px 0;
    }
    .tc-start {
      display: flex;
      align-items: center;
      gap: 22px;
      min-width: 0;
    }
    .tc-logo {
      display: block;
      height: 40px;
      width: auto;
    }
    .tc-end {
      display: flex;
      align-items: center;
      gap: 24px;
      margin-inline-start: auto;
    }
    [dir="rtl"] .back-btn i { transform: scaleX(-1); }
    .lang-switch,
    .end-btn {
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
    }
    /* Round keys of 64 px, in px like the keyboard: they do not grow with the text. */
    .tc-icon {
      display: grid;
      place-items: center;
      box-sizing: border-box;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      border: 3px solid #ffffff;
      background: linear-gradient(145deg, var(--c-primary), var(--c-primary-hover));
      color: var(--c-on-primary);
      font-size: 32px;
      box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.7);
      transition: transform 0.2s ease;
    }
    button:hover .tc-icon { transform: scale(1.06); }
    /* The language screen is open: its key shows where the citizen is. */
    .lang-switch.current .tc-icon {
      background: #ffffff;
      color: #1750c8;
    }
    .end-btn .tc-icon {
      background: #ffffff;
      color: #cd212a;
      font-size: 34px;
    }
    :host-context([data-cvd="contrast"]) .tc-icon {
      background: #000000;
      color: #ffd400;
    }
  `
})
export class TopControls {
  public state = inject(AppStateService);
  public session = inject(SessionService);

  /** "Indietro" and the logo; the welcome screen has neither. */
  readonly withBack = input(true);
  /** The language screen: its key is shown as the page in course. */
  readonly languageCurrent = input(false);
  /** The chat: the key that ends the conversation, after a confirmation. */
  readonly endable = input(false);

  readonly back = output<void>();
  readonly language = output<void>();
}
