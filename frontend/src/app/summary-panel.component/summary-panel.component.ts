import { Component, inject } from '@angular/core';
import { AppStateService } from '../app-state.service';
import { LinkViewerService } from '../link-viewer.service';
import { PrintService } from '../print.service';
import { TopicSection, TopicsService, topicIcon } from '../topics';

/**
 * Beside the chat, "Il tuo riepilogo": for each subject of the conversation what to bring to the
 * counter, the forms and the sources; the subject in course open, the previous ones as rows that
 * open on a touch. Before the first answer, how the kiosk works. At the bottom, the print of the
 * summary for the counter.
 */
@Component({
  selector: 'app-summary-panel',
  standalone: true,
  templateUrl: './summary-panel.component.html',
  styleUrls: ['./summary-panel.component.css']
})
export class SummaryPanel {
  public state = inject(AppStateService);
  public topics = inject(TopicsService);
  public viewer = inject(LinkViewerService);
  public printer = inject(PrintService);

  icon(topic: string): string {
    return topicIcon(topic);
  }

  /**
   * What a closed subject holds, as "label: number" so that no language has to agree a noun with
   * the number ("1 moduli"). A count of zero is left out: with the summary turned off, "nothing to
   * bring" would be wrong.
   */
  counts(section: TopicSection): string {
    const parts: string[] = [];
    if (section.bring.length) parts.push(this.state.t('summaryBringCount', { n: section.bring.length }));
    if (section.forms.length) parts.push(this.state.t('summaryFormsCount', { n: section.forms.length }));
    return parts.join(' · ');
  }

  print(): void {
    this.printer.ask({ title: this.state.t('convDocTitle') });
  }
}
