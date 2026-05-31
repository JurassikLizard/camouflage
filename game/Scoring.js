'use strict';

/**
 * Calculate round scores for the original single-chameleon mode.
 *
 * @param {string}   chameleonId      - playerId of the chameleon
 * @param {Object}   votes            - { [voterId]: targetPlayerId }
 * @param {boolean}  chameleonGuessed - did chameleon correctly guess the word?
 * @param {Object}   config           - scoring config
 * @returns {{ deltas: Object, outcome: string }}
 */
function calculateScores(chameleonId, votes, chameleonGuessed, config = {}) {
  const {
    pointsForCorrectVote   = 1,
    chameleonEscapePoints  = 3,
    chameleonCaughtPoints  = 0,
  } = config;

  const deltas = {};  // { playerId: pointsEarned }

  // Count votes against the chameleon
  const voteValues = Object.values(votes);
  const votesAgainstChameleon = voteValues.filter(v => v === chameleonId).length;
  const totalVotes = voteValues.length;
  const majorityThreshold = Math.floor(totalVotes / 2) + 1;
  const chameleonCaught = votesAgainstChameleon >= majorityThreshold;

  let outcome;

  if (!chameleonCaught) {
    // Chameleon not caught by majority → chameleon wins
    outcome = 'chameleon_escaped';
    deltas[chameleonId] = chameleonEscapePoints;
  } else if (chameleonGuessed) {
    // Caught but correctly guessed the word → chameleon wins
    outcome = 'chameleon_guessed_word';
    deltas[chameleonId] = chameleonEscapePoints;
  } else {
    // Caught and couldn't guess → players win
    outcome = 'chameleon_caught';
    deltas[chameleonId] = chameleonCaughtPoints;
  }

  // Award voters who correctly identified the chameleon (only if chameleon lost)
  if (outcome === 'chameleon_caught') {
    for (const [voterId, targetId] of Object.entries(votes)) {
      if (targetId === chameleonId && voterId !== chameleonId) {
        deltas[voterId] = (deltas[voterId] || 0) + pointsForCorrectVote;
      }
    }
  }

  return { deltas, outcome, chameleonCaught, votesAgainstChameleon };
}

function sameUnorderedSet(a, b) {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every(x => bSet.has(x));
}

/**
 * Calculate round scores for Chaos Mode.
 *
 * Each vote is a two-stage ballot: first the player guesses the imposter count,
 * then they select exactly that many suspects. The suspect order is ignored.
 *
 * @param {string[]} actualImposterIds - server-selected hidden imposter team
 * @param {Object} votes - { [voterId]: { count: number, suspects: string[] } }
 * @param {Object} config - scoring config
 */
function calculateChaosScores(actualImposterIds, votes, chameleonGuessed = false, config = {}) {
  const { pointsForCorrectVote = 1, chameleonEscapePoints = 3 } = config;
  const actual = [...actualImposterIds];
  const actualSet = new Set(actual);
  const deltas = {};
  const correctVoters = [];

  for (const [voterId, ballot] of Object.entries(votes)) {
    const guessedCount = Number(ballot?.count);
    const suspects = Array.isArray(ballot?.suspects) ? [...new Set(ballot.suspects)] : [];

    const countMatches = guessedCount === actual.length;
    const suspectsMatch = sameUnorderedSet(suspects, actual);

    if (countMatches && suspectsMatch) {
      correctVoters.push(voterId);

      // Chaos Mode fix: imposters should not earn points for identifying
      // themselves/their own team. Only non-imposters are rewarded.
      if (!actualSet.has(voterId) && !chameleonGuessed) {
        deltas[voterId] = (deltas[voterId] || 0) + pointsForCorrectVote;
      }
    }
  }

  if (chameleonGuessed && actual.length > 0) {
    // If a caught imposter correctly guesses the secret word, the imposter team
    // escapes. Award escape points to every imposter in Chaos Mode.
    for (const imposterId of actual) {
      deltas[imposterId] = (deltas[imposterId] || 0) + chameleonEscapePoints;
    }
  }

  return {
    deltas,
    outcome: chameleonGuessed ? 'chaos_imposter_guessed_word' : 'chaos_scored',
    chameleonCaught: correctVoters.some(voterId => !actualSet.has(voterId)),
    votesAgainstChameleon: correctVoters.filter(voterId => !actualSet.has(voterId)).length,
    correctVoters,
  };
}

module.exports = { calculateScores, calculateChaosScores };
