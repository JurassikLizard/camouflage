'use strict';

// Each pack has a topic and exactly 16 words
const WORD_PACKS = [
  {
    topic: 'Things at the Beach',
    words: ['Sunscreen','Towel','Umbrella','Seagull','Sandcastle','Waves','Surfboard','Crab','Lifeguard','Cooler','Flipflops','Sunburn','Jellyfish','Shell','Pier','Tide']
  },
  {
    topic: 'Types of Movies',
    words: ['Horror','Comedy','Thriller','Romance','Action','Documentary','Animated','Western','Musical','Sci-Fi','Drama','Fantasy','Mystery','Noir','Biopic','Heist']
  },
  {
    topic: 'Things in a Kitchen',
    words: ['Spatula','Colander','Whisk','Ladle','Blender','Grater','Tongs','Skillet','Peeler','Knife','Sieve','Ramekin','Mortar','Wok','Timer','Scale']
  },
  {
    topic: 'Occupations',
    words: ['Pilot','Surgeon','Architect','Chef','Firefighter','Judge','Plumber','Chemist','Dentist','Astronaut','Detective','Librarian','Mechanic','Nurse','Painter','Vet']
  },
  {
    topic: 'Animals',
    words: ['Narwhal','Pangolin','Meerkat','Axolotl','Capybara','Ocelot','Pigeon','Tardigrade','Wombat','Tapir','Cassowary','Mudskipper','Binturong','Fossa','Numbat','Dugong']
  },
  {
    topic: 'Famous Landmarks',
    words: ['Colosseum','Stonehenge','Parthenon','Alhambra','Angkor Wat','Big Ben','Machu Picchu','Acropolis','Taj Mahal','Petra','Chichen Itza','Sagrada Familia','Hagia Sophia','Mont-Saint-Michel','Moai','Ayers Rock']
  },
  {
    topic: 'Sports',
    words: ['Fencing','Curling','Polo','Lacrosse','Squash','Bobsled','Archery','Handball','Rowing','Kabaddi','Snooker','Pentathlon','Luge','Croquet','Jai Alai','Sepak Takraw']
  },
  {
    topic: 'Things That Are Round',
    words: ['Globe','Manhole','Pizza','Hula Hoop','Wheel','Coin','Bubble','Button','Clock','Porthole','Tire','Eyeball','Pea','Record','Frisbee','Bagel']
  }
];

/**
 * Pick a random pack, select one word as the secret, shuffle the grid per-player.
 * Returns { topic, words: string[16], secretWord }
 */
function generateRound() {
  const pack = WORD_PACKS[Math.floor(Math.random() * WORD_PACKS.length)];
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