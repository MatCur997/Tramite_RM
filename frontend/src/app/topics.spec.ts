import { ChatMessage } from './app-state.service';
import { topicMarks, topicSections } from './topics';

const question = (text: string): ChatMessage => ({ text, sender: 'user' });
const answer = (topic: string | null, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  text: 'Risposta [1].',
  sender: 'bot',
  topic,
  ...extra
});

describe('argomenti della conversazione', () => {
  const cieForm = { id: 'modulo-cie', title: 'Modulo CIE', url: 'http://x/files/modulo-cie.pdf', topic: 'cie' };
  const ciePage = { number: 1, title: 'CIE', kind: 'pagina', url: 'https://roma.it/cie', topic: 'cie' };
  const messages: ChatMessage[] = [
    { text: 'Ciao!', sender: 'bot' }, // 0: the greeting of the chat
    question('Buongiorno'), // 1
    answer(null), // 2: a greeting has no subject
    question("Carta d'identità?"), // 3
    answer('cie', { bring: ['Foto'], forms: [cieForm], sources: [ciePage] }), // 4
    question('E quanto costa?'), // 5
    answer('cie', { bring: ['foto', 'Ricevuta'], sources: [ciePage] }), // 6
    question('Grazie'), // 7
    answer(null), // 8: goes with the subject in course
    question('E per la residenza?'), // 9
    answer('residenza', { bring: ['Documento'] }), // 10
    question('Torno alla carta: e per mio figlio?'), // 11
    answer('cie') // 12
  ];

  it('mette un separatore prima delle domande che aprono un argomento, diverso per il primo', () => {
    expect(topicMarks(messages)).toEqual([
      { index: 3, topic: 'cie', first: true },
      { index: 9, topic: 'residenza', first: false },
      { index: 11, topic: 'cie', first: false }
    ]);
  });

  it('raccoglie per argomento domande, cose da portare, moduli e fonti, senza ripetizioni', () => {
    const [cie, residenza] = topicSections(messages);

    expect(cie).toMatchObject({ topic: 'cie', start: 11, messages: [3, 4, 5, 6, 7, 8, 11, 12], bring: ['Foto', 'Ricevuta'] });
    expect(cie.forms).toEqual([cieForm]);
    expect(cie.sources).toEqual([ciePage]);
    expect(residenza).toMatchObject({ topic: 'residenza', start: 9, messages: [9, 10], bring: ['Documento'] });
  });

  it('senza argomenti (saluti, o un backend che non li manda) non ci sono separatori né sezioni', () => {
    const plain = [question('Ciao'), answer(null), question('Grazie'), { text: 'Prego', sender: 'bot' } as ChatMessage];

    expect(topicMarks(plain)).toEqual([]);
    expect(topicSections(plain)).toEqual([]);
  });

  it('una risposta ancora in arrivo resta nell’argomento in corso', () => {
    const waiting = [...messages.slice(0, 5), question('E i costi?'), { text: '', sender: 'bot', pending: true } as ChatMessage];

    expect(topicSections(waiting)[0].messages).toEqual([3, 4, 5, 6]);
  });
});
