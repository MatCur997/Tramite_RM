import { Component, ElementRef, HostListener, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { AppStateService } from '../app-state.service';
import { AccessibilityService } from '../accessibility.service';
import { LinkViewer } from '../link-viewer.component/link-viewer.component';
import { LinkViewerService } from '../link-viewer.service';
import { SessionService } from '../session.service';
import { VirtualKeyboard } from '../virtual-keyboard.component/virtual-keyboard.component';

export function webappUrl(lang: string | null): string {
  return `webapp/index.html?lang=${encodeURIComponent(lang ?? 'it')}&embed=1`;
}

export const WEBAPP_BACK_MESSAGE = 'tramite:back';
export const WEBAPP_LANG_MESSAGE = 'tramite:lang';
/** A link of the web app: the kiosk has no tabs, so it opens over the web app. */
export const WEBAPP_OPEN_MESSAGE = 'tramite:open';

/** The text fields of the web app that the on-screen keyboard writes in. */
const TEXT_FIELDS = 'input[type="search"], input[type="text"], input:not([type]), textarea';

@Component({
  selector: 'app-webapp',
  standalone: true,
  imports: [LinkViewer, VirtualKeyboard],
  template: `
    <iframe #frame class="webapp" [class.kb-open]="!!field()" [src]="src()" [title]="state.t('optOffices')"
            allow="geolocation" (load)="onFrameLoad()"></iframe>
    @if (field(); as input) {
      <app-virtual-keyboard
        [lang]="state.selectedLanguage()"
        [target]="input"
        [(value)]="fieldValue"
        (valueChange)="onKeyboardInput(input)"
        (enter)="submitField(input)"
        (close)="closeKeyboard()" />
    }
    @if (viewer.link()) {
      <div class="webapp-viewer" [attr.dir]="state.dir()"><app-link-viewer /></div>
    }
  `,
  styles: `
    :host { display: block; }
    /* Over the whole web app, with a small margin. */
    .webapp-viewer {
      position: fixed;
      inset: 0;
      z-index: 1000;
      box-sizing: border-box;
      padding: 24px;
      background: color-mix(in srgb, var(--c-hd) 82%, transparent);
    }
    .webapp-viewer app-link-viewer { height: 100%; }
    .webapp {
      display: block;
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      border: 0;
    }
    /* The keyboard covers the bottom of the screen: the web app ends just above it. */
    .webapp.kb-open {
      height: calc(100vh - var(--kb-h, 220px));
      height: calc(100dvh - var(--kb-h, 220px));
    }
  `
})
export class WebApp implements OnDestroy {
  public state = inject(AppStateService);
  public viewer = inject(LinkViewerService);
  private sanitizer = inject(DomSanitizer);
  private a11y = inject(AccessibilityService);
  private session = inject(SessionService);

  private frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');

  readonly src = computed(() => this.sanitizer.bypassSecurityTrustResourceUrl(webappUrl(this.state.selectedLanguage())));

  /** The web app's text field the on-screen keyboard is writing in, or null when it is closed. */
  readonly field = signal<HTMLInputElement | null>(null);
  readonly fieldValue = signal('');

  ngOnDestroy(): void {
    this.viewer.close();
  }

  /**
   * The web app is a page of the same site: the kiosk listens to its text fields and opens its
   * own keyboard, since the kiosk has no system keyboard.
   */
  onFrameLoad(): void {
    this.field.set(null);
    let doc: Document | null = null;
    try {
      doc = this.frame().nativeElement.contentDocument;
    } catch {
      return;
    }
    if (!doc) return;

    // Touches inside the web app do not reach the kiosk's page: they keep the session alive too.
    this.session.watch(doc);

    // No system keyboard as well, on tablets or touch screens that have one.
    doc.querySelectorAll<HTMLInputElement>(TEXT_FIELDS).forEach((el) => el.setAttribute('inputmode', 'none'));

    const open = (event: Event) => {
      const el = (event.target as Element | null)?.closest?.(TEXT_FIELDS) as HTMLInputElement | null;
      if (el) this.openKeyboard(el);
    };
    doc.addEventListener('focusin', open);
    doc.addEventListener('click', open);
    // A touch elsewhere in the web app closes the keyboard (the keyboard itself is outside it).
    doc.addEventListener('pointerdown', (event) => {
      const field = this.field();
      if (field && event.target !== field) this.closeKeyboard();
    });
  }

  private openKeyboard(el: HTMLInputElement): void {
    if (this.field() === el) return;
    this.fieldValue.set(el.value);
    this.field.set(el);
    // Once the web app has become shorter, the field is brought back into view above the keyboard.
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  }

  /** The web app reacts to typing (it hides the "city not found" message, for example). */
  onKeyboardInput(el: HTMLInputElement): void {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** "Enter" sends the field's form, as the "Show offices" button does. */
  submitField(el: HTMLInputElement): void {
    const form = el.form;
    this.closeKeyboard();
    form?.requestSubmit();
  }

  closeKeyboard(): void {
    const el = this.field();
    if (!el) return;
    this.field.set(null);
    el.blur();
  }

  // A touch outside the keyboard (on the kiosk's own buttons) closes it.
  @HostListener('document:pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (!this.field()) return;
    if ((event.target as Element | null)?.closest('app-virtual-keyboard')) return;
    this.closeKeyboard();
  }

  @HostListener('window:message', ['$event'])
  onMessage(event: MessageEvent): void {
    if (event.origin !== location.origin) return;
    // The accessibility options may have been changed inside the web app.
    if (event.data?.type === WEBAPP_BACK_MESSAGE) {
      this.a11y.reload();
      this.state.currentStep.set('choice');
    } else if (event.data?.type === WEBAPP_LANG_MESSAGE) {
      this.a11y.reload();
      this.state.goToLanguage('webapp');
    } else if (event.data?.type === WEBAPP_OPEN_MESSAGE && typeof event.data.url === 'string') {
      this.closeKeyboard();
      this.viewer.open({ url: event.data.url, title: String(event.data.title || event.data.url) });
    }
  }
}
