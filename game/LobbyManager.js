'use strict';

const { GameState } = require('./GameState');

function randomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

class LobbyManager {
  constructor() {
    this.lobbies = new Map(); // code → GameState
    this.tokenToLobby = new Map(); // playerToken → { lobbyCode, playerId }
  }

  createLobby(isPublic = true) {
    let code;
    do { code = randomCode(); } while (this.lobbies.has(code));
    const gs = new GameState(code);
    gs.isPublic = isPublic;
    this.lobbies.set(code, gs);
    return gs;
  }

  getLobby(code) {
    return this.lobbies.get(code.toUpperCase()) || null;
  }

  publicLobbies() {
    return [...this.lobbies.values()]
      .filter(g => g.isPublic && g.phase === 'lobby')
      .map(g => {
        const connected = g.getPlayerList().filter(p => p.connected);
        return {
          code:        g.lobbyCode,
          playerCount: connected.length,
          players:     connected.map(p => p.name),
        };
      });
  }

  /** Register or update a token→lobby mapping */
  registerToken(token, lobbyCode, playerId) {
    this.tokenToLobby.set(token, { lobbyCode, playerId });
  }

  /** Look up a previously seen token */
  lookupToken(token) {
    return this.tokenToLobby.get(token) || null;
  }

  /** Check if a lobby is effectively empty (no players or all offline) */
  isLobbyEffectivelyEmpty(gs) {
    if (gs.players.size === 0) return true;
    const connectedPlayers = [...gs.players.values()].filter(p => p.connected);
    return connectedPlayers.length === 0;
  }

  /** Remove lobbies with no players at all or all players offline */
  pruneEmpty() {
    for (const [code, gs] of this.lobbies) {
      if (this.isLobbyEffectivelyEmpty(gs)) {
        this.lobbies.delete(code);
      }
    }
  }
}

module.exports = new LobbyManager(); // singleton