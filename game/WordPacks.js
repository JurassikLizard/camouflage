'use strict';

// Each pack has a topic and exactly 16 words
// Optional 'group' field: group 1 = special packs, group 2 = Xtra tier
const WORD_PACKS = [
  {
    topic: 'Things at the Beach',
    words: ['Sunscreen','Towel','Umbrella','Seagull','Sandcastle','Waves','Surfboard','Crab','Lifeguard','Cooler','Flipflops','Sunburn','Jellyfish','Shell','Pier','Tide']
  },
  {
    topic: 'Types of Movies',
    words: ['Horror','Comedy','Thriller','Romance','Action','Documentary','Animated','Western','Musical','Sci-Fi','Drama','Fantasy','Mystery','Noir','XXX','Brainrot']
  },
  {
    topic: 'Superheroes',
    words: ['Batman','Superman','Spider Man','Iron Man','Hulk','Thor','Wonder Woman','Flash','Aquaman','Captain America','Black Panther','Wolverine','Deadpool','Robin','Joker','Loki']
  },
  {
    topic: 'Occupations',
    words: ['Pilot','Surgeon','Architect','Chef','Firefighter','Judge','Plumber','Chemist','Dentist','Astronaut','Detective','Librarian','Mechanic','Nurse','Painter','Vet']
  },
  {
    topic: 'Animals',
    words: ['Narwhal','Tarantula','Camel','Axolotl','Capybara','Ocelot','Pigeon','Giraffe','Wombat','Tapir','Cat','Blobfish','Fruit Bat','Ostritch','Whale','Eagle']
  },
  {
    topic: 'Sports',
    words: ['Soccer','Basketball','Baseball','Football','Tennis','Golf','Hockey','Volleyball','Swimming','Track','Boxing','Wrestling','Cricket','Rugby','Skiing','Cycling']
  },
  {
    topic: 'Things That Are Round',
    words: ['Globe','Manhole','Pizza','Hula Hoop','Wheel','Coin','Bubble','Button','Clock','Pothole','Tire','Eyeball','Pea','Record','Frisbee','Bagel']
  },
  // {
  //   topic: 'Things You Should Not Lick',
  //   words: ['Battery','Toilet','Cactus','Soap','Road','Tire','Fence','Glue','Shoe','Trash','Paint','BatteryAcid','Mop','Carpet','Mailbox','Worm']
  // },
  {
    topic: 'SUIUC Activities',
    group: 1,
    words: ['Basketball','Poker','Drinking','Fortnite','Minecraft','Ping Pong','Comedy','BBQ','Frisbee','Smash','Wii Sports','Graffiti','Chipotle','Track','Raping Kaan','Harvard Sq.']
  },
  {
    topic: 'Bad Superpowers',
    words: ['Sneezing','Hiccups','Yawning','Blushing','Burping','Crying','Sleepwalking','Snoring','Forgetfulness','Clumsiness','Procrastination','Dizziness','Shivering','Stuttering','Daydreaming','Mumbling']
  },
  {
    topic: 'People We Know',
    group: 1,
    words: ['Andrew','Kaan','Kaiyan','Daniel','Jonathan','Ian','Andrey','Gautam','Seamus','Larry','Ruhi','Meera','Chloe','Avery','Melody','Tabitha']
  },
  {
    topic: 'Movies',
    group: 1,
    words: ['Minecraft Movie','Interstellar','Swapped','Spider-Verse','American Psycho','Parasite','Wolf of Wall Street','The Social Network','Spirited Away','Inception','No Way Home','Glass Onion','Knives Out','Dead Poets Society','Dune','Titanic']
  },
  {
    topic: 'Athletes',
    group: 1,
    words: ['LeBron James','Michael Jordan','Cristiano Ronaldo','Lionel Messi','Serena Williams','Shai Gilgeous-Alexander','Neymar','Shohei Ohtani','Stephen Curry','Lewis Hamilton','Tom Brady','Patrick Mahomes','Jannik Sinner','Michael Phelps','Novak Djokovic','Usain Bolt']
  },
  {
    topic: 'Brainrot',
    group: 1,
    words: ['Ballerina Cappuccina','Bombardiro Crocodilo','Tung Tung Tung Sahur','Chimpanzini Bananini','Cappuccino Assassino','Tralalero Tralala','Skibidi Toilet','Lirili Larila','La Vacca Saturno Saturnita','Brr Brr Patapim','Bombombini Gusini','Smurf Cat','Strawberry Elephant','Boneca Ambalabu','John Pork','Bobrito Bandito']
  }
];


/**
 * packTiers is now an array of tier strings: ['normal', 'special', 'xtra']
 * - 'normal'  → packs with no group (undefined)
 * - 'special' → packs with group === 1
 * - 'xtra'    → packs with group === 2
 */
function generateRound(packTiers = ['normal']) {
  const tiers = Array.isArray(packTiers) ? packTiers : [packTiers];

  const groupMap = { normal: undefined, special: 1, xtra: 2 };
  const wantedGroups = new Set(tiers.map(t => groupMap[t]));

  let availablePacks = WORD_PACKS.filter(pack => wantedGroups.has(pack.group));

  if (availablePacks.length === 0) availablePacks = WORD_PACKS;

  const pack = availablePacks[Math.floor(Math.random() * availablePacks.length)];
  const secretWord = pack.words[Math.floor(Math.random() * pack.words.length)];
  return { topic: pack.topic, words: [...pack.words], secretWord };
}

/**
 * Shuffle words into a 4x4 grid uniquely per player (same words, different positions)
 */
function shuffleGridForPlayer(words) {
  const shuffled = [...words];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled; // flat array of 16, rendered as 4x4 on client
}

module.exports = { generateRound, shuffleGridForPlayer, WORD_PACKS };