/**
 * Word Rush puzzles — Phase 6.
 *
 * Each puzzle is a letter rack plus every word this game will accept from it.
 *
 * A real dictionary was the obvious alternative and is the wrong call here.
 * Shipping one means either a huge word list in the repo or a network lookup on
 * the scoring path, and both buy a strictness nobody wants in a cafe game —
 * being told "ZA is not a word" by a hangout is annoying, not challenging.
 * Curated racks also mean every puzzle is known-solvable, which a random rack
 * is not, and 06 asks for "genuinely fun in short bursts", not rigorous.
 *
 * Answers are lowercase and deduplicated. Longer words score more, so the long
 * ones at the end of each list are the payoff for looking a moment longer.
 */

export interface WordPuzzle {
  /** Seven letters, uppercase, shown in rack order. */
  letters: string;
  /** Every accepted word, lowercase. */
  words: string[];
}

export const WORD_PUZZLES: WordPuzzle[] = [
  {
    letters: 'TRAINED',
    words: [
      'ran', 'rat', 'tan', 'tar', 'ear', 'era', 'end', 'den', 'ate', 'eat', 'tea', 'air', 'aid',
      'rain', 'rant', 'dear', 'read', 'dare', 'tear', 'tire', 'tide', 'ride', 'rate', 'nadir',
      'train', 'trade', 'tread', 'tired', 'drain', 'diner', 'ranted', 'detain', 'tirade', 'trained',
    ],
  },
  {
    letters: 'GARDENS',
    words: [
      'age', 'ads', 'ear', 'end', 'era', 'gas', 'red', 'sad', 'sea', 'nag', 'rag', 'ran',
      'dare', 'dear', 'read', 'gear', 'rage', 'sand', 'send', 'ends', 'ages', 'rang', 'rand',
      'grade', 'grand', 'range', 'anger', 'snare', 'nadir', 'dares', 'reads', 'sedan',
      'danger', 'garden', 'gander', 'gardens',
    ],
  },
  {
    letters: 'MONITOR',
    words: [
      'ion', 'nor', 'rot', 'tin', 'ton', 'too', 'rim', 'mint', 'moor', 'moot', 'room', 'root',
      'riot', 'trio', 'onto', 'into', 'iron', 'torn', 'omit', 'motor', 'moron', 'minor', 'intro',
      'monitor',
    ],
  },
  {
    letters: 'PLASTIC',
    words: [
      'cap', 'cat', 'sat', 'sit', 'sip', 'lap', 'lip', 'lit', 'tap', 'tip', 'pal', 'pit',
      'clap', 'clip', 'slap', 'slip', 'slit', 'spit', 'salt', 'last', 'list', 'past', 'pact',
      'clasp', 'split', 'spilt', 'clips', 'plait', 'pilot', 'plastic',
    ],
  },
  {
    letters: 'BROWSED',
    words: [
      'bed', 'bow', 'bore', 'bred', 'brew', 'bros', 'dew', 'doe', 'dose', 'drew', 'owe', 'owes',
      'red', 'rob', 'rod', 'roe', 'row', 'sob', 'sow', 'web', 'wed', 'woe', 'word', 'wore',
      'words', 'sword', 'below', 'below', 'sober', 'boxer', 'bowed', 'browse', 'browsed',
    ],
  },
  {
    letters: 'CHAPTER',
    words: [
      'ace', 'ape', 'arc', 'art', 'ate', 'car', 'cap', 'cat', 'ear', 'eat', 'hat', 'her',
      'pat', 'pet', 'rat', 'tap', 'tea', 'the', 'chap', 'char', 'chat', 'cheap', 'cheat',
      'heart', 'earth', 'reach', 'peach', 'patch', 'perch', 'preach', 'chapter',
    ],
  },
  {
    letters: 'FRIENDS',
    words: [
      'den', 'die', 'dine', 'end', 'fed', 'fin', 'fir', 'fire', 'fried', 'fern', 'ides',
      'ire', 'red', 'rid', 'ride', 'rise', 'send', 'side', 'sir', 'sin', 'fine', 'find',
      'finds', 'diner', 'rides', 'fires', 'fried', 'infer', 'finer', 'friend', 'friends',
    ],
  },
  {
    letters: 'STUDIED',
    words: [
      'die', 'dis', 'due', 'dud', 'dues', 'dust', 'duet', 'edit', 'ides', 'its', 'sit',
      'sue', 'suit', 'side', 'suds', 'tide', 'ties', 'used', 'use', 'tied', 'tues',
      'suited', 'duties', 'studied',
    ],
  },
];
