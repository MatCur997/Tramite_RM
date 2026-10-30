import { Component, OnDestroy, inject } from '@angular/core';
import { AppStateService } from '../app-state.service';
import { TopControls } from '../top-controls.component';

export interface LanguageOption {
  code: string;
  nativeName: string;
  translatedName: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'it', nativeName: 'Italiano', translatedName: '' },
  { code: 'uk', nativeName: 'Українська', translatedName: 'Ucraino' },
  { code: 'zh', nativeName: '中文', translatedName: 'Cinese' },
  { code: 'bn', nativeName: 'বাংলা', translatedName: 'Bengali' },
  { code: 'tl', nativeName: 'Tagalog', translatedName: 'Filippino' },
  { code: 'ar', nativeName: 'العربية', translatedName: 'Arabo' },
];

const RTL = ['ar'];

/** "Choose your language" in each language, under the title in the others. */
const CHOOSE: Record<string, string> = {
  it: 'Scegli la tua lingua',
  uk: 'Оберіть свою мову',
  zh: '请选择您的语言',
  bn: 'আপনার ভাষা বেছে নিন',
  tl: 'Piliin ang iyong wika',
  ar: 'اختر لغتك',
};

export const RETURN_DELAY_MS = 600;

@Component({
  selector: 'app-language',
  standalone: true,
  imports: [TopControls],
  templateUrl: './language.component.html',
  styleUrls: ['./language.component.css']
})
export class Language implements OnDestroy {
  public state = inject(AppStateService);

  readonly languages = LANGUAGES;
  private timer?: ReturnType<typeof setTimeout>;

  others(): { code: string; text: string }[] {
    const current = this.state.selectedLanguage() ?? 'it';
    return LANGUAGES.filter((lang) => lang.code !== current).map((lang) => ({ code: lang.code, text: CHOOSE[lang.code] }));
  }

  isSelected(code: string): boolean {
    return (this.state.selectedLanguage() ?? 'it') === code;
  }

  dirOf(code: string): 'rtl' | 'ltr' {
    return RTL.includes(code) ? 'rtl' : 'ltr';
  }

  selectLanguage(lang: LanguageOption): void {
    this.state.setLanguage(lang.code);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.state.closeLanguage(), RETURN_DELAY_MS);
  }

  back(): void {
    clearTimeout(this.timer);
    this.state.closeLanguage();
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
