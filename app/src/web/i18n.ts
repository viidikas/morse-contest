// Interface texts in English and Estonian.

export type Lang = 'en' | 'et';

const TEXT = {
  title: { en: 'Morse trainer', et: 'Morse treener' },
  intro: {
    en: 'Listen to the groups and type what you hear. Each answer is locked when the next group starts.',
    et: 'Kuula gruppe ja trüki, mida kuuled. Vastus lukustub, kui algab järgmine grupp.',
  },
  settings: { en: 'Settings', et: 'Seaded' },
  level: { en: 'Level (number of characters)', et: 'Tase (märkide arv)' },
  chars: { en: 'Characters', et: 'Märgid' },
  charSpeed: { en: 'Character speed (WPM)', et: 'Märgi kiirus (WPM)' },
  effSpeed: { en: 'Overall speed (WPM)', et: 'Üldkiirus (WPM)' },
  pitch: { en: 'Pitch (Hz)', et: 'Toonikõrgus (Hz)' },
  volume: { en: 'Volume', et: 'Helitugevus' },
  groups: { en: 'Number of groups', et: 'Gruppide arv' },
  pause: { en: 'Pause after each group (s)', et: 'Paus pärast gruppi (s)' },
  testTone: { en: 'Test tone', et: 'Proovitoon' },
  start: { en: 'Start', et: 'Alusta' },
  stop: { en: 'Stop', et: 'Katkesta' },
  again: { en: 'New round', et: 'Uus voor' },
  getReady: { en: 'Get ready…', et: 'Valmistu…' },
  group: { en: 'Group', et: 'Grupp' },
  typeHere: { en: 'Type here', et: 'Trüki siia' },
  duration: { en: 'Round length', et: 'Vooru pikkus' },
  result: { en: 'Result', et: 'Tulemus' },
  accuracy: { en: 'Accuracy', et: 'Täpsus' },
  correctOf: { en: 'correct of', et: 'õiget,  kokku' },
  sent: { en: 'Sent', et: 'Saadetud' },
  typed: { en: 'Typed', et: 'Trükitud' },
  perChar: { en: 'By character', et: 'Märkide kaupa' },
  char: { en: 'Character', et: 'Märk' },
  times: { en: 'Sent', et: 'Saadetud' },
  right: { en: 'Correct', et: 'Õigeid' },
  confusions: { en: 'Most common mix-ups', et: 'Sagedasemad segiajamised' },
  heardAs: { en: 'typed as', et: 'trükitud kui' },
  noConfusions: { en: 'None.', et: 'Puuduvad.' },
  legend: {
    en: 'Green = correct, red = wrong, underscore = missed, crossed out = extra.',
    et: 'Roheline = õige, punane = vale, alakriips = vahele jäänud, läbi kriipsutatud = liigne.',
  },
  levelUp: {
    en: 'Above 90%. You are ready for the next level.',
    et: 'Üle 90%. Oled valmis järgmiseks tasemeks.',
  },
  toContest: { en: 'Go to the contest', et: 'Mine võistlusele' },
  toTrainer: { en: 'Practise alone', et: 'Harjuta üksi' },
  contestTitle: { en: 'Morse contest', et: 'Morse võistlus' },
  contestIntro: {
    en: 'Everyone hears the same Morse at the same moment. Type what you hear; the scoreboard comes at the end.',
    et: 'Kõik kuulevad sama morset samal hetkel. Trüki, mida kuuled; edetabel selgub lõpus.',
  },
  yourName: { en: 'Your name or callsign', et: 'Sinu nimi või kutsung' },
  join: { en: 'Join', et: 'Liitu' },
  nameRequired: { en: 'Please enter a name.', et: 'Palun sisesta nimi.' },
  roomFull: { en: 'The room is full.', et: 'Ruum on täis.' },
  noConnection: { en: 'No connection to the server. Retrying…', et: 'Ühendus serveriga puudub. Proovin uuesti…' },
  startsIn: { en: 'Session starts in', et: 'Sessioon algab' },
  startsAt: { en: 'Start at', et: 'Algus kell' },
  inRoom: { en: 'In the room', et: 'Ruumis' },
  soundCheck: { en: 'Sound check', et: 'Heliproov' },
  enableSound: { en: 'Turn sound on', et: 'Lülita heli sisse' },
  soundOff: {
    en: 'Sound is off in this tab. Press the button, otherwise you will hear nothing.',
    et: 'Heli on sellel vahelehel väljas. Vajuta nuppu, muidu sa ei kuule midagi.',
  },
  roomChars: { en: 'Characters in this session', et: 'Selle sessiooni märgid' },
  speed: { en: 'Speed', et: 'Kiirus' },
  joinedLate: {
    en: 'The session is already running. You join from the next group.',
    et: 'Sessioon juba käib. Liitud järgmisest grupist.',
  },
  waitingResults: { en: 'Collecting results…', et: 'Kogun tulemusi…' },
  scoreboard: { en: 'Scoreboard', et: 'Edetabel' },
  rank: { en: 'Place', et: 'Koht' },
  name: { en: 'Name', et: 'Nimi' },
  points: { en: 'Points', et: 'Punktid' },
  yourResult: { en: 'Your result', et: 'Sinu tulemus' },
  nextSession: { en: 'Join the next session', et: 'Liitu järgmise sessiooniga' },
  nextAt: { en: 'Next session at', et: 'Järgmine sessioon kell' },
} as const;

export type Key = keyof typeof TEXT;

export function t(key: Key, lang: Lang): string {
  return TEXT[key][lang];
}
