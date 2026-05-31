'use strict';

const { generateRound, shuffleGridForPlayer } = require('./WordPacks');
const { calculateScores } = require('./Scoring');

const PHASES = {
  LOBBY:   'lobby',
  DEALING: 'dealing',
  HINTING: 'hinting',
  VOTING:  'voting',
  REVEAL:  'reveal',
};

const DEFAULT_SETTINGS = {
  spyMode:              'sealed',  // 'live' | 'sealed' | 'none'
  spyCount:             3,         // number of players chameleon can spy on
  hintingTimeout:       0,         // seconds (0 = disabled)
  chameleonGuessTimeout: 20,       // seconds
  packTiers:            ['normal'], // array: 'normal' | 'special' | 'xtra'
  chaosMode:            false,      // hides the number of imposters and uses two-stage voting
};

class GameState {
  constructor(lobbyCode) {
    this.lobbyCode   = lobbyCode;
    this.phase       = PHASES.LOBBY;
    this.players     = new Map(); // playerId → { name, score, connected, socketId }
    this.hostId      = null;
    this.settings    = { ...DEFAULT_SETTINGS };
    this.pendingTimeouts = []; // Track active timeouts for cleanup

    // Round-specific state (reset each round)
    this._resetRound();
  }

  _resetRound() {
    this.chameleonId  = null;
    this.imposterIds   = [];
    this.actualImposterCount = 0;
    this.topic        = null;
    this.secretWord   = null;
    this.words        = [];          // canonical 16-word list
    this.playerGrids  = new Map();   // playerId → shuffled 16-word array
    this.hints        = new Map();   // playerId → { text, submitted }
    this.votes        = new Map();   // normal: voterId → targetPlayerId; chaos: voterId → { count, suspects }
    this.roundResult  = null;
    this.chameleonGuessWord = null;
    this.caughtImposterId = null;    // Chaos Mode: imposter who earned a majority suspect vote and may guess the word
    this.submitOrder  = [];          // order in which players submitted hints (for spy targeting)
  }

  // ── Timeout management ──────────────────────────────────────────────────────

  registerTimeout(timeoutId) {
    this.pendingTimeouts.push(timeoutId);
  }

  clearAllTimeouts() {
    for (const timeoutId of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts = [];
  }

  // ── Player management ──────────────────────────────────────────────────────

  addPlayer(playerId, name, socketId) {
    const isFirst = this.players.size === 0;
    const existing = this.players.get(playerId);
    this.players.set(playerId, {
      name,
      score: existing ? existing.score : 0,
      connected: true,
      socketId,
    });
    if (isFirst || !this.hostId) this.hostId = playerId;
    return isFirst;
  }

  reconnectPlayer(playerId, socketId) {
    const p = this.players.get(playerId);
    if (!p) return false;
    p.connected = true;
    p.socketId  = socketId;
    return true;
  }

  disconnectPlayer(playerId) {
    const p = this.players.get(playerId);
    if (p) p.connected = false;
    // Transfer host if needed
    if (this.hostId === playerId) {
      const next = [...this.players.entries()].find(([id, pl]) => id !== playerId && pl.connected);
      this.hostId = next ? next[0] : null;
    }
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    if (this.hostId === playerId) {
      const next = [...this.players.keys()][0] || null;
      this.hostId = next;
    }
  }

  getPlayerList() {
    return [...this.players.entries()].map(([id, p]) => ({
      id, name: p.name, score: p.score, connected: p.connected,
      isHost: id === this.hostId,
    }));
  }

  // ── Round lifecycle ────────────────────────────────────────────────────────

  startRound() {
    if (this.players.size < 3) throw new Error('Need at least 3 players');
    this._resetRound();

    const { topic, words, secretWord } = generateRound(this.settings.packTiers);
    this.topic      = topic;
    this.words      = words;
    this.secretWord = secretWord;
    this.phase      = PHASES.DEALING;

    const ids = [...this.players.keys()];

    if (this.settings.chaosMode) {
      // Chaos Mode: choose a hidden random imposter count from 0..round(playerCount / 3).
      // The count is stored only in server-side round state and is never included in publicState().
      const maxImposters = this.maxChaosImposters();
      this.actualImposterCount = Math.floor(Math.random() * (maxImposters + 1));
      this.imposterIds = this._randomSample(ids, this.actualImposterCount);
      this.chameleonId = this.imposterIds[0] || null; // kept for backward-compatible role checks
    } else {
      // Normal mode: keep the original single-chameleon behavior.
      this.chameleonId = ids[Math.floor(Math.random() * ids.length)];
      this.imposterIds = [this.chameleonId];
      this.actualImposterCount = 1;
    }

    // Give each player a shuffled grid
    for (const id of ids) {
      this.playerGrids.set(id, shuffleGridForPlayer(words));
      this.hints.set(id, { text: '', submitted: false });
    }
  }

  maxChaosImposters() {
    return Math.round(this.players.size / 3);
  }

  _randomSample(ids, count) {
    const shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, count);
  }

  beginHinting() {
    this.phase = PHASES.HINTING;
  }

  updateHint(playerId, text) {
    const h = this.hints.get(playerId);
    if (!h || h.submitted) return null;
    h.text = text.slice(0, 80); // cap length
    return h.text;
  }

  submitHint(playerId) {
    const h = this.hints.get(playerId);
    if (!h) return false;
    h.submitted = true;
    // Track submission order for spy targeting
    if (!this.submitOrder.includes(playerId)) {
      this.submitOrder.push(playerId);
    }
    return true;
  }

  allHintsSubmitted() {
    return [...this.hints.values()].every(h => h.submitted);
  }

  /**
   * Returns hints visible to a given player depending on spyMode.
   * For the chameleon in 'live' or 'sealed' mode, only the first spyCount players are visible.
   */
  hintsVisibleTo(playerId) {
    const isChameleon = this.imposterIds.includes(playerId);
    const result = {};
    
    // Determine which players have started typing (have non-empty text)
    const playersWithHints = [...this.hints.entries()]
      .filter(([pid, h]) => !this.imposterIds.includes(pid) && h.text && h.text.trim().length > 0)
      .map(([pid]) => pid);
    
    // For spy targeting: use submitOrder if available, otherwise fall back to playersWithHints
    const spyTargets = this.submitOrder.length > 0 
      ? this.submitOrder 
      : playersWithHints;
    
    // Determine which players chameleon can spy on (first N)
    const spiedPlayers = new Set(spyTargets.slice(0, this.settings.spyCount));
    
    for (const [pid, h] of this.hints) {
      if (pid === playerId) {
        result[pid] = { text: h.text, submitted: h.submitted };
        continue;
      }
      if (this.phase === PHASES.VOTING || this.phase === PHASES.REVEAL) {
        // Everyone can see all submitted hints
        result[pid] = { text: h.text, submitted: h.submitted };
      } else if (isChameleon) {
        // Spy mode logic with spyCount limit
        if (this.settings.spyMode === 'live') {
          // Chameleon can see live updates from first N players (those who have started typing)
          if (spiedPlayers.has(pid)) {
            result[pid] = { text: h.text, submitted: h.submitted };
          } else {
            result[pid] = { text: null, submitted: h.submitted };
          }
        } else if (this.settings.spyMode === 'sealed') {
          // Chameleon can see submitted hints from first N players
          if (spiedPlayers.has(pid) && h.submitted) {
            result[pid] = { text: h.text, submitted: true };
          } else {
            result[pid] = { text: null, submitted: h.submitted };
          }
        } else {
          // spyMode === 'none': no hints visible
          result[pid] = { text: null, submitted: h.submitted };
        }
      } else {
        // Normal player: only know if others have submitted
        result[pid] = { text: null, submitted: h.submitted };
      }
    }
    return result;
  }

  castVote(voterId, targetId) {
    if (this.phase !== PHASES.VOTING) return false;

    if (this.settings.chaosMode) {
      // Chaos Mode stores a complete two-stage ballot in one synced vote payload.
      // Shape: { count: number, suspects: string[] }. Suspect order does not matter for scoring.
      const ballot = targetId || {};
      const count = Number(ballot.count);
      const suspects = Array.isArray(ballot.suspects) ? ballot.suspects : [];
      const max = this.maxChaosImposters();
      const uniqueSuspects = [...new Set(suspects)];

      if (!Number.isInteger(count) || count < 0 || count > max) return false;
      if (count === 0 && uniqueSuspects.length !== 0) return false;
      if (count > 0 && uniqueSuspects.length !== count) return false;
      if (uniqueSuspects.some(id => !this.players.has(id))) return false;

      this.votes.set(voterId, { count, suspects: uniqueSuspects });
      return true;
    }

    if (!this.players.has(targetId)) return false;
    this.votes.set(voterId, targetId);
    return true;
  }

  allVotesCast() {
    return this.votes.size >= this.players.size;
  }

  submitChameleonGuess(word) {
    this.chameleonGuessWord = word;
  }

  /**
   * Chaos Mode helper: find whether any actual imposter received a majority of
   * suspect selections. This keeps the normal “caught imposter guesses the word”
   * flow while still supporting ballots that may contain multiple suspects.
   */
  getChaosCaughtImposterId() {
    if (!this.settings.chaosMode || this.imposterIds.length === 0) return null;

    const suspectCounts = new Map(this.imposterIds.map(id => [id, 0]));
    for (const ballot of this.votes.values()) {
      const suspects = Array.isArray(ballot?.suspects) ? new Set(ballot.suspects) : new Set();
      for (const imposterId of this.imposterIds) {
        if (suspects.has(imposterId)) {
          suspectCounts.set(imposterId, (suspectCounts.get(imposterId) || 0) + 1);
        }
      }
    }

    const majorityThreshold = Math.floor(this.players.size / 2) + 1;
    let caughtId = null;
    let caughtVotes = 0;
    for (const [imposterId, count] of suspectCounts.entries()) {
      if (count >= majorityThreshold && count > caughtVotes) {
        caughtId = imposterId;
        caughtVotes = count;
      }
    }
    return caughtId;
  }

  finalizeRound() {
    const chameleonGuessed =
      this.chameleonGuessWord?.toLowerCase().trim() === this.secretWord.toLowerCase().trim();

    const votesObj = Object.fromEntries(this.votes);
    const { calculateChaosScores } = require('./Scoring');
    const { deltas, outcome, chameleonCaught, votesAgainstChameleon, correctVoters } = this.settings.chaosMode
      ? calculateChaosScores(this.imposterIds, votesObj, chameleonGuessed, this.settings)
      : calculateScores(this.chameleonId, votesObj, chameleonGuessed, this.settings);

    // Apply deltas
    for (const [pid, pts] of Object.entries(deltas)) {
      const p = this.players.get(pid);
      if (p) p.score += pts;
    }

    this.roundResult = {
      outcome,
      chameleonId: this.chameleonId,
      caughtImposterId: this.caughtImposterId,
      imposterIds: this.settings.chaosMode ? this.imposterIds : [this.chameleonId],
      actualImposterCount: this.settings.chaosMode ? this.actualImposterCount : 1,
      secretWord:  this.secretWord,
      chameleonGuessWord: this.chameleonGuessWord,
      chameleonGuessed,
      chameleonCaught,
      votesAgainstChameleon,
      correctVoters,
      votes: votesObj,
      deltas,
      scores: Object.fromEntries([...this.players.entries()].map(([id, p]) => [id, p.score])),
    };

    this.phase = PHASES.REVEAL;
    return this.roundResult;
  }

  returnToLobby() {
    this.clearAllTimeouts();
    this.phase = PHASES.LOBBY;
    this._resetRound();
  }

  // ── Serialisation helpers ─────────────────────────────────────────────────

  /** Safe state snapshot sent to all players */
  publicState() {
    return {
      lobbyCode:  this.lobbyCode,
      phase:      this.phase,
      hostId:     this.hostId,
      settings:   { ...this.settings, chaosMaxImposters: this.maxChaosImposters() },
      players:    this.getPlayerList(),
      topic:      this.topic,
      // words / secretWord are per-player (sent privately)
      roundResult: this.roundResult,
    };
  }

  /** Private data for one player */
  privateState(playerId) {
    const isChameleon = this.imposterIds.includes(playerId);
    return {
      isChameleon,
      grid:       this.playerGrids.get(playerId) || null,
      secretWord: isChameleon ? null : this.secretWord,
      hints:      this.hintsVisibleTo(playerId),
      myVote:     this.votes.get(playerId) || null,
      chaosMaxImposters: this.maxChaosImposters(),
    };
  }
}

module.exports = { GameState, PHASES };