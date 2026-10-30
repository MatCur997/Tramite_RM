import { Component, inject } from '@angular/core';
import { AppStateService } from './app-state.service';
import { AccessibilityService } from './accessibility.service';
import { SessionService } from './session.service';
import { Welcome } from './welcome.component/welcome.component';
import { Language } from './language.component/language.component';
import { Choice } from './choice.component/choice.component';
import { Chatbot } from './chatbot.component/chatbot.component';
import { WebApp } from './webapp.component/webapp.component';
import { PrintDialog } from './print-dialog.component';
import { IdleWarning } from './idle-warning.component';
import { EndDialog } from './end-dialog.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [Welcome, Language, Choice, Chatbot, WebApp, PrintDialog, EndDialog, IdleWarning],
  template: `
    @if (state.currentStep() !== 'webapp') {
      <div class="stripe" aria-hidden="true"></div>
    }
    <main>
      @switch (state.currentStep()) {
        @case ('welcome') { <app-welcome /> }
        @case ('language') { <app-language /> }
        @case ('choice') { <app-choice /> }
        @case ('chatbot') { <app-chatbot /> }
        @case ('webapp') { <app-webapp /> }
      }
    </main>
    <!-- The accessibility key is in each screen's top row (app-top-controls); the web app has its own. -->
    <app-print-dialog />
    <app-end-dialog />
    <app-idle-warning />
  `
})
export class App {
  public state = inject(AppStateService);
  private a11y = inject(AccessibilityService);
  // Started with the app: the inactivity timer runs on every screen.
  private session = inject(SessionService);
}
