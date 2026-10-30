# Frontend

Angular 21 user interface of the kiosk: standalone components, state in signals, no zone.js and no router (the screen shown is a signal). It runs in Chrome in kiosk mode on a touch screen, at `http://localhost:4200`, and calls the backend at `http://localhost:8000` ([`src/app/api.config.ts`](src/app/api.config.ts)).

```bash
npm ci
npm start                     # ng serve, http://localhost:4200
npm test -- --watch=false     # unit tests (Vitest, jsdom)
npm run build                 # production build in dist/ (not used by the kiosk)
```

## Screens

[`AppStateService.currentStep`](src/app/app-state.service.ts) chooses the screen shown by [`App`](src/app/app.ts):

| Step | Component | What the citizen does |
| --- | --- | --- |
| `welcome` | [`welcome.component`](src/app/welcome.component/) | Touches the screen to start, or the globe to choose the language; "Welcome" is written below in the other five languages |
| `language` | [`language.component`](src/app/language.component/) | Chooses one of the six languages, cards in a 3 × 2 grid; Arabic turns the layout right to left |
| `choice` | [`choice.component`](src/app/choice.component/) | Chooses between "Parla con l'assistente" and "Trova l'ufficio più vicino", two illustrated cards |
| `chatbot` | [`chatbot.component`](src/app/chatbot.component/) | Asks questions; reads the answers, their sources and forms, and beside them the summary of each subject; prints; the red X ends the conversation |
| `webapp` | [`webapp.component`](src/app/webapp.component/) | Finds registry offices and CAF on a map (the web app of `public/webapp/`, in a frame) |

Every screen starts with the same row of keys, [`top-controls.component.ts`](src/app/top-controls.component.ts), straight on the blue background: "Indietro" and the Tramite logo at the start (not on the welcome screen, whose logo is in the middle); at the end, always in this order, accessibility, language and, in the chat only, the red X that ends the conversation after a confirmation ([`end-dialog.component.ts`](src/app/end-dialog.component.ts)). The accessibility panel opens below its key. In Arabic the row is mirrored. Over every screen: the print dialog ([`print-dialog.component.ts`](src/app/print-dialog.component.ts)), the end dialog and the inactivity warning ([`idle-warning.component.ts`](src/app/idle-warning.component.ts)).

The screens keep the dark blue background of the kiosk; their panels are light blue (`--c-panel`, `--c-panel-line`, `--c-panel-foot` in [`src/styles.css`](src/styles.css)), and only what the citizen reads or touches inside them is white: the answers, the text field, the secondary keys, the page of a form. [`src/accessibility.css`](src/accessibility.css) gives the panels their colours in the dark theme and in the other palettes.

The texts of the screens are in [`src/assets/translation.json`](src/assets/translation.json), one object per language (`it`, `uk`, `zh`, `bn`, `tl`, `ar`). `state.t(key)` falls back to Italian, then to the key itself; `state.t(key, { n: 3 })` fills the `{n}` placeholders. A text with a number either has its own key for one (`printOneSheet`) or reads "label: number" (`summaryFormsCount`, "Moduli: 1"), because Ukrainian and Arabic change the noun with the number.

## Chat

- **Layout.** Two panels across the screen, under the top row: the conversation, with "Assistente dell'Anagrafe" on white at the top and the bar to write at the bottom (field, "Parla", "Invia", 76 px tall), and the summary beside it. A form or a source open takes the place of the summary, wide, with the conversation narrow beside it.
- **Answers.** [`Chatbot.sendMessage`](src/app/chatbot.component/chatbot.component.ts) posts the question to `/api/chat/stream` with the language and the session id, and shows the answer while it arrives (one JSON event per line), then its sources and forms. Leaving the chat aborts an answer still arriving. [`chat-message.component`](src/app/chat-message.component/) draws each message: the question in a blue bubble at the end, the answer in a white box with the assistant's avatar, its source numbers as light blue badges that screen readers read as "fonte 2", the reading keys, the forms and the sources. The messages sit at the bottom of the conversation, under a note that it is private.
- **First question.** The conversation starts empty: until the citizen asks something, [`chat-start.component.ts`](src/app/chat-start.component.ts) says "Buongiorno, come posso aiutarti?" and shows six subjects in a grid; a touch sends that subject's sample question (`topicStart.<id>` in the texts).
- **Subjects.** The backend gives each answer the subject of its first source (`topic`: `cie`, `residenza`, `stranieri`, `certificati`, `autocertificazione`, `estero`, `stato-civile`). [`topics.ts`](src/app/topics.ts) puts a divider before each question that opens a subject ("Argomento:" for the first, "Nuovo argomento:" for the next ones) and groups the conversation by subject; an answer without one, such as a greeting, stays with the subject in course. The chips at the end of the conversation's header ([`topic-chips.component.ts`](src/app/topic-chips.component.ts)) list the subjects: touching an earlier one scrolls back to it and the question field asks about it, and "Torna all'ultima domanda" goes back to the end.
- **Summary.** In windows 1200 px wide or more, [`summary-panel.component`](src/app/summary-panel.component/) stays beside the chat: for the subject in course, what to bring to the counter (the `summary` event of the stream), the forms and the sources; the earlier subjects as rows that open on a touch. Before the first answer it says how the kiosk works. Its key prints the summary for the counter; narrower windows have no panel and keep the chat's own print key.
- **Links.** Sources and forms open next to the chat, in the [link viewer](src/app/link-viewer.component/link-viewer.component.ts), wide, with the conversation narrow beside it: PDFs as page images rendered with pdf.js (the PDFs of other sites through `/api/pdf`), one page at a time with "Pagina x di y" between two arrows, under a bar that keeps in view the title, "Modulo ufficiale · 4 pagine", "Stampa" and "Chiudi"; pages of sites that allow it in a frame (`/api/embeddable`); the others as their saved text (`copy`) with a QR code to open them on a phone.
- **Dictation.** "Parla": [`SpeechService.dictate`](src/app/speech.service.ts) records the microphone until 1.5 s of silence (at most 30 s) and sends the recording to `/api/transcribe` in the kiosk's language. The key turns red with "Ti ascolto…" while it records and shows "Sto trascrivendo…" until the words are in the field.
- **Reading aloud.** "Ascolta" reads an answer with the offline voice of its language: [`SpeechService`](src/app/speech.service.ts) cuts it into lines and sentences (also at the Chinese, Arabic and Bengali full stops), asks `/api/tts` for each one as a WAV, preparing the next while one plays, and plays them in order, without source numbers and links. "Pausa" and "Riprendi" stop and resume at the same point; "Ricomincia" starts again from the beginning. The keys appear only in the languages listed by `/api/tts/languages`, those whose voice the backend has loaded.
- **On-screen keyboard.** [`virtual-keyboard.component`](src/app/virtual-keyboard.component/) (simple-keyboard) has a layout per language and, for Chinese, a pinyin input method whose dictionary, `public/ime/zh-pinyin.txt`, is built from the Android PinyinIME data by [`scripts/build-pinyin-dict.mjs`](scripts/build-pinyin-dict.mjs). In the chat it hangs under the conversation, down to the bottom edge and as wide as its column (`docked`), with keys of 60 px, "Invia", "Nascondi" and, in the languages with another script, a globe key for the Latin letters; the summary or the document beside it keep their height, and with a document open the conversation widens while writing. In the office finder it floats at the bottom of the screen.

## Printing

The print keys of the summary panel, of the chat and of a form's viewer open the same dialog. [`PrintService`](src/app/print.service.ts) lists the documents of the conversation by subject ([`print-docs.component.ts`](src/app/print-docs.component.ts)): the summary for the counter of each subject, ticked, and its forms, ticked when the citizen opened them, when they are the only form of the subject, or when the print started from their viewer. The citizen unticks what they do not need, looks at any document full size, page by page ([`print-preview.component.ts`](src/app/print-preview.component.ts)), and confirms the number of sheets.

The pages go as PNG images to `/api/print/stream`, which prints them on the kiosk's Bluetooth printer without any dialog and reports each sheet: the dialog shows "foglio 2 di 5", and if the printer stops, the sheet where it stopped and "Riprova", which prints again from there. A backend without the stream (404 or 405) gets the whole job at `/api/print`. The dialog closes 5 seconds after a print that went well.

The summary for the counter, drawn as A4 pages by [`conversation-doc.ts`](src/app/conversation-doc.ts), has the subject, what to bring and the questions and answers about it. When the conversation is not in Italian, the messages are first translated by `/api/conversation/translate` and drawn in two columns, original on the left and Italian on the right.

## Session and privacy

[`SessionService`](src/app/session.service.ts) watches touches and key presses, in the kiosk's page and in the office finder's frame. After 70 seconds without any, it shows the "Sei ancora lì?" warning, which counts down 20 seconds; a touch keeps the session. At the end of the countdown, or with the chat's red X and "Chiudi e cancella", the session ends: dictation and reading stop, the print dialog and the link viewer close, the accessibility choices go back to their defaults, the language, the conversation and the forms opened are forgotten, and the kiosk goes back to the welcome screen with a new session id. The timer waits while an answer, a transcription, a reading or a print is in progress.

`localStorage` holds only the accessibility choices (`a11y-prefs-v1`, shared with the office finder and reset at the end of each session) and the office finder's cache of map searches.

## Accessibility

The panel of [`accessibility.component`](src/app/accessibility.component/), opened by the first round key of the top row, changes the text size, the font (OpenDyslexic, Atkinson Hyperlegible), the colours (for colour vision deficiencies, high contrast, soft), the theme, the spacing, the underlining of links and the motion. [`AccessibilityService`](src/app/accessibility.service.ts) applies them as attributes of `<html>`, styled in [`src/accessibility.css`](src/accessibility.css), with the same options, storage key and format as the office finder's panel ([`public/webapp/accessibility.js`](public/webapp/accessibility.js)).

## Office finder

[`public/webapp/`](public/webapp/) is a separate web app in plain JavaScript, served by the same server and shown in a frame with `?lang=xx&embed=1`. It looks for registry offices and CAF around a place with Leaflet and OpenStreetMap (Overpass, Nominatim, Photon), so it needs the internet. [`dati/sedi-precaricate.js`](public/webapp/dati/sedi-precaricate.js) holds the offices of Rome and Verona, downloaded by `node public/webapp/scripts/aggiorna-dati.mjs`, so that the searches in those areas do not wait for the public servers.

The frame talks to the kiosk with `postMessage`: `tramite:back` (back to the choice screen), `tramite:lang` (language choice) and `tramite:open` (a link, opened in the kiosk's link viewer). The kiosk writes in its text fields with its own on-screen keyboard. Inside the kiosk (`embed=1`) the web app copies the kiosk's top row: "Indietro" and the Tramite logo at the start, its accessibility key before the language key at the end, at the same places. Its header keeps, besides them, only its three links, centred in the window with the same room on both sides (`--back-w`, measured by `app.js`) and on the same line as the keys; the site's own name and description are hidden. The header, with all of them, stays at the top of the screen while the page scrolls; the map, which stays in view beside the list of offices, and what the page scrolls to stop below it (`--head-h`, measured by `app.js`).

## Kiosk behaviour

[`src/main.ts`](src/main.ts) and [`src/styles.css`](src/styles.css) turn off what a public touch screen should not do: zoom by pinch or `Ctrl` + wheel, the context menu of a long press, text selection outside the text fields, dragging of images and links. `html, body { overflow: clip }` keeps a pixel too many from giving the page scrollbars; the layout check below turns it off, so that such pixels still count.

## Tests

`npm test -- --watch=false` runs the specs next to the code (`*.spec.ts`), with Vitest in jsdom: screens and navigation, chat stream, subjects and summary, session and inactivity, reading aloud, the print dialog (choice of documents, progress, retry), accessibility, keyboard layouts and pinyin input. Test names are in Italian. `fetch`, the audio, the backend and the timers are faked, so the tests need neither the backend nor a browser.

With `npm start` running, `node scripts/check-layout.mjs` opens every screen in headless Chrome, at 1920×1080 and 1536×864 (Windows at 125%), with the text at 100% and 200%, in Italian and in Arabic, including a conversation with its summary, the keyboard, a form open, the accessibility panel, the end dialog and the print dialog with its preview, and exits with 1 if any of them needs a scrollbar. It never prints and needs neither the backend nor the models (without the backend the form shows its error, which must fit as well).

`ng build` warns that the initial bundle and the styles of the chat, keyboard and accessibility components exceed the Angular budgets of [`angular.json`](angular.json) (4 kB per component); 8 kB fail the build. The styles of each message are in their own component, which keeps the chat at about 4 kB.
