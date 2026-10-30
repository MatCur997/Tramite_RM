import { Injectable, signal } from '@angular/core';

export interface ViewerLink {
  url: string;
  title: string;
  /** The saved text of the page (a Markdown file), for sites that cannot be shown in a frame. */
  copy?: string | null;
  /** The kind of document, as in the sources: "modulo" for the forms. */
  kind?: string;
}

// The kiosk has no tabs: every link, file or page opens inside it, in the link viewer. The chat
// shows it next to itself, wide, with the conversation narrow beside it; the web app shows it over the whole screen.
@Injectable({
  providedIn: 'root'
})
export class LinkViewerService {
  readonly link = signal<ViewerLink | null>(null);
  /** The addresses the citizen has opened: the forms among them come selected in the print dialog. */
  readonly opened = signal<ReadonlySet<string>>(new Set());

  open(link: ViewerLink): void {
    this.link.set(link);
    this.opened.update((urls) => new Set(urls).add(link.url));
  }

  close(): void {
    this.link.set(null);
  }

  /** The end of a citizen's session: nothing of what they opened is remembered. */
  forget(): void {
    this.close();
    this.opened.set(new Set());
  }
}
