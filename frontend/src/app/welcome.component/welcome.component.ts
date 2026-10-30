import { Component, computed, inject } from '@angular/core';
import { AppStateService } from '../app-state.service';
import { TopControls } from '../top-controls.component';

const TAP_TEXTS: Record<string, string> = {
  it: 'Tocca lo schermo per iniziare',
  uk: 'Торкніться екрана, щоб почати',
  zh: '触摸屏幕开始',
  bn: 'শুরু করতে স্ক্রিন স্পর্শ করুন',
  tl: 'Pindutin ang screen para magsimula',
  ar: 'المس الشاشة للبدء',
};

/** "Welcome" in each language of the kiosk, in its own script: fixed, not translated. */
const HELLOS: Record<string, string> = {
  it: 'Benvenuto',
  uk: 'Ласкаво просимо',
  zh: '欢迎',
  bn: 'স্বাগতম',
  tl: 'Maligayang pagdating',
  ar: 'أهلاً وسهلاً',
};

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [TopControls],
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css']
})
export class Welcome {
  public state = inject(AppStateService);

  readonly tapText = computed(() => TAP_TEXTS[this.state.selectedLanguage() ?? 'it'] ?? TAP_TEXTS['it']);
  readonly hellos = computed(() => {
    const current = this.state.selectedLanguage() ?? 'it';
    return Object.entries(HELLOS)
      .filter(([code]) => code !== current)
      .map(([code, text]) => ({ code, text }));
  });

  start(): void {
    this.state.currentStep.set('choice');
  }

  openLanguage(): void {
    this.state.openLanguageFromWelcome();
  }
}
