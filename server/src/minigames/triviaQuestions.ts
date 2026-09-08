/**
 * Trivia Blitz question bank.
 *
 * Server-side only. 06 notes this "could later pull from a study-relevant
 * question bank (nice thematic tie-in: trivia about whatever your friend group
 * is studying)" — that is why this is a plain exported array behind the room
 * rather than something baked into the game scene. Swapping it for a database
 * table or a per-group bank means changing this module, nothing else.
 *
 * General knowledge for now, weighted towards things a mixed group can all have
 * a fair go at rather than trivia that rewards one specialism.
 */

import type { TriviaQuestion } from '@commons/shared';

export const TRIVIA_QUESTIONS: TriviaQuestion[] = [
  {
    id: 'q_planets',
    prompt: 'Which planet has the shortest day?',
    options: ['Mercury', 'Jupiter', 'Earth', 'Neptune'],
    answerIndex: 1,
  },
  {
    id: 'q_ocean',
    prompt: 'What is the largest ocean on Earth?',
    options: ['Atlantic', 'Indian', 'Pacific', 'Arctic'],
    answerIndex: 2,
  },
  {
    id: 'q_bytes',
    prompt: 'How many bits are in a byte?',
    options: ['4', '8', '16', '32'],
    answerIndex: 1,
  },
  {
    id: 'q_everest',
    prompt: 'Which mountain range contains Mount Everest?',
    options: ['Andes', 'Alps', 'Rockies', 'Himalayas'],
    answerIndex: 3,
  },
  {
    id: 'q_photosynthesis',
    prompt: 'What gas do plants mainly take in for photosynthesis?',
    options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'],
    answerIndex: 1,
  },
  {
    id: 'q_shakespeare',
    prompt: 'Who wrote "Twelfth Night"?',
    options: ['Marlowe', 'Shakespeare', 'Chaucer', 'Jonson'],
    answerIndex: 1,
  },
  {
    id: 'q_prime',
    prompt: 'Which of these is a prime number?',
    options: ['51', '57', '61', '69'],
    answerIndex: 2,
  },
  {
    id: 'q_currency',
    prompt: 'What is the currency of Japan?',
    options: ['Won', 'Yuan', 'Yen', 'Ringgit'],
    answerIndex: 2,
  },
  {
    id: 'q_http',
    prompt: 'What does the "S" in HTTPS stand for?',
    options: ['Simple', 'Secure', 'Standard', 'Static'],
    answerIndex: 1,
  },
  {
    id: 'q_lightyear',
    prompt: 'A light year measures what?',
    options: ['Time', 'Distance', 'Brightness', 'Mass'],
    answerIndex: 1,
  },
  {
    id: 'q_continent',
    prompt: 'Which continent has the most countries?',
    options: ['Asia', 'Europe', 'Africa', 'South America'],
    answerIndex: 2,
  },
  {
    id: 'q_water',
    prompt: 'At what temperature does water freeze, in Celsius?',
    options: ['-10', '0', '10', '32'],
    answerIndex: 1,
  },
  {
    id: 'q_dna',
    prompt: 'What does DNA stand for?',
    options: [
      'Deoxyribonucleic acid',
      'Dinucleic acid',
      'Deoxyribose nucleotide',
      'Dual nucleic acid',
    ],
    answerIndex: 0,
  },
  {
    id: 'q_pi',
    prompt: 'Pi is closest to which value?',
    options: ['2.72', '3.14', '3.41', '4.13'],
    answerIndex: 1,
  },
  {
    id: 'q_sahara',
    prompt: 'The Sahara desert is mostly in which continent?',
    options: ['Asia', 'Africa', 'Australia', 'South America'],
    answerIndex: 1,
  },
  {
    id: 'q_keyboard',
    prompt: 'What are the first six letters on a standard keyboard?',
    options: ['ASDFGH', 'QWERTY', 'ZXCVBN', 'POIUYT'],
    answerIndex: 1,
  },
  {
    id: 'q_bones',
    prompt: 'Roughly how many bones are in an adult human body?',
    options: ['106', '206', '306', '406'],
    answerIndex: 1,
  },
  {
    id: 'q_venus',
    prompt: 'Which planet is hottest at the surface?',
    options: ['Mercury', 'Venus', 'Mars', 'Jupiter'],
    answerIndex: 1,
  },
  {
    id: 'q_binary',
    prompt: 'What is 1011 in binary, as a decimal number?',
    options: ['9', '11', '13', '15'],
    answerIndex: 1,
  },
  {
    id: 'q_nile',
    prompt: 'Which river flows through Cairo?',
    options: ['Congo', 'Niger', 'Nile', 'Zambezi'],
    answerIndex: 2,
  },
];
