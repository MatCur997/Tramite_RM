import { Component, inject } from '@angular/core';
import { AppStateService } from '../app-state.service';
import { TopControls } from '../top-controls.component';

@Component({
  selector: 'app-choice',
  standalone: true,
  imports: [TopControls],
  templateUrl: './choice.component.html',
  styleUrls: ['./choice.component.css']
})
export class Choice {
  public state = inject(AppStateService);

  openAssistant(): void {
    this.state.startChat();
  }

  openOffices(): void {
    this.state.currentStep.set('webapp');
  }

  goBack(): void {
    this.state.currentStep.set('welcome');
  }

  goToLanguageSelection(): void {
    this.state.goToLanguage('choice');
  }
}
