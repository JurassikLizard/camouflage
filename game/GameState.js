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
};

class GameState {
  constructor(lobbyCode) {
    this.lobbyCode   = lobbyCode;
    this.phase       = PHASES.LOBBY;
    this.players     = new Map(); // playerId → { name, score, connected, socketId }
    this.hostId      = null;
    this.settings    = { ...DEFAULT_SETTINGS };

    // Round-specific state (reset each round)
    this._resetRound();
  }

  _resetRound() {
    this.chameleonId  = null;
    this.topic        = null;
    this.secretWord   = null;
    this.words        = [];          // canonical 16-word list
    this.playerGrids  = new Map();   // playerId → shuffled 16-word array
    this.hints        = new Map();   // playerId → { text, submitted }
    this.votes        = new Map();   // voterId  → targetPlayerId
    this.roundResult  = null;
    this.chameleonGuessWord = null;
    this.submitOrder  = [];          // order in which players submitted hints (for spy targeting)
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

    const { topic, words, secretWord } = generateRound();
    this.topic      = topic;
    this.words      = words;
    this.secretWord = secretWord;
    this.phase      = PHASES.DEALING;

    // Pick chameleon randomly
    const ids = [...this.players.keys()];
    this.chameleonId = ids[Math.floor(Math.random() * ids.length)];

    // Give each player a shuffled grid
    for (const id of ids) {
      this.playerGrids.set(id, shuffleGridForPlayer(words));
      this.hints.set(id, { text: '', submitted: false });
    }
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
    const isChameleon = playerId === this.chameleonId;
    const result = {};
    
    // Determine which players chameleon can see (first N in submitOrder)
    const spiedPlayers = new Set(this.submitOrder.slice(0, this.settings.spyCount));
    
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
          // Chameleon can see live updates from first N players
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
    if (!this.players.has(targetId))  return false;
    this.votes.set(voterId, targetId);
    return true;
  }

  allVotesCast() {
    return this.votes.size >= this.players.size;
  }

  submitChameleonGuess(word) {
    this.chameleonGuessWord = word;
  }

  finalizeRound() {
    const chameleonGuessed =
      this.chameleonGuessWord?.toLowerCase().trim() === this.secretWord.toLowerCase().trim();

    const votesObj = Object.fromEntries(this.votes);
    const { deltas, outcome, chameleonCaught, votesAgainstChameleon } =
      calculateScores(this.chameleonId, votesObj, chameleonGuessed, this.settings);

    // Apply deltas
    for (const [pid, pts] of Object.entries(deltas)) {
      const p = this.players.get(pid);
      if (p) p.score += pts;
    }

    this.roundResult = {
      outcome,
      chameleonId: this.chameleonId,
      secretWord:  this.secretWord,
      chameleonGuessWord: this.chameleonGuessWord,
      chameleonGuessed,
      chameleonCaught,
      votesAgainstChameleon,
      votes: votesObj,
      deltas,
      scores: Object.fromEntries([...this.players.entries()].map(([id, p]) => [id, p.score])),
    };

    this.phase = PHASES.REVEAL;
    return this.roundResult;
  }

  returnToLobby() {
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
      settings:   this.settings,
      players:    this.getPlayerList(),
      topic:      this.topic,
      // words / secretWord are per-player (sent privately)
      roundResult: this.roundResult,
    };
  }

  /** Private data for one player */
  privateState(playerId) {
    const isChameleon = playerId === this.chameleonId;
    return {
      isChameleon,
      grid:       this.playerGrids.get(playerId) || null,
      secretWord: isChameleon ? null : this.secretWord,
      hints:      this.hintsVisibleTo(playerId),
      myVote:     this.votes.get(playerId) || null,
    };
  }
}

module.exports = { GameState, PHASES };