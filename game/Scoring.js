'use strict';

/**
 * Calculate round scores.
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

module.exports = { calculateScores };