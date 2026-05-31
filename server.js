'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');

const lobbyManager = require('./game/LobbyManager');
const { PHASES }   = require('./game/GameState');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chameleon server running on :${PORT}`));

// ── Helpers ────────────────────────────────────────────────────────────────

function broadcastLobby(gs) {
  const pub = gs.publicState();
  io.to(gs.lobbyCode).emit('state:public', pub);
  for (const [pid, player] of gs.players) {
    if (player.socketId) {
      io.to(player.socketId).emit('state:private', gs.privateState(pid));
    }
  }
}

function broadcastPublicLobbies() {
  io.emit('lobbies:list', lobbyManager.publicLobbies());
}

function err(socket, msg) {
  socket.emit('error:msg', msg);
}

/**
 * Check if the game is in an active round phase and cannot continue.
 * - Chameleon left → forfeit to reveal screen so players see what happened.
 * - Fewer than 3 connected players → abort to lobby with a message.
 */
function checkRoundViability(gs) {
  const activePhases = [PHASES.DEALING, PHASES.HINTING, PHASES.VOTING];
  if (!activePhases.includes(gs.phase)) return;

  const connectedPlayers = [...gs.players.values()].filter(p => p.connected);

  // Normal mode has exactly one chameleon. Chaos Mode may have zero imposters,
  // so a null chameleonId is valid and must not end the round as a forfeit.
  if (!gs.settings.chaosMode) {
    const chameleon = gs.players.get(gs.chameleonId);
    const chameleonGone = !chameleon || !chameleon.connected;

    if (chameleonGone) {
      // Show reveal screen so remaining players learn who the chameleon was
      gs.forfeitRound();
      io.to(gs.lobbyCode).emit('error:msg', 'The Chameleon fled! Round ended.');
      broadcastLobby(gs);
      return;
    }
  }

  if (connectedPlayers.length < 3) {
    io.to(gs.lobbyCode).emit('error:msg', 'Not enough players — round cancelled.');
    gs.returnToLobby();
    broadcastLobby(gs);
  }
}

// ── Socket.IO ──────────────────────────────────────────────────────────────

io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  socket.on('lobbies:get', () => {
    socket.emit('lobbies:list', lobbyManager.publicLobbies());
  });

  socket.on('lobby:create', ({ username, isPublic, token }) => {
    if (!username?.trim()) return err(socket, 'Username required');
    const gs = lobbyManager.createLobby(isPublic !== false);
    const playerId = uuidv4();
    gs.addPlayer(playerId, username.trim(), socket.id);
    lobbyManager.registerToken(token, gs.lobbyCode, playerId);
    socket.join(gs.lobbyCode);
    socket.emit('lobby:joined', { lobbyCode: gs.lobbyCode, playerId });
    broadcastLobby(gs);
    broadcastPublicLobbies();
  });

  socket.on('lobby:join', ({ lobbyCode, username, token }) => {
    const code = lobbyCode?.toUpperCase?.();
    const gs   = lobbyManager.getLobby(code);
    if (!gs) return err(socket, 'Lobby not found');
    if (gs.phase !== PHASES.LOBBY) return err(socket, 'Game already in progress');
    if (!username?.trim()) return err(socket, 'Username required');

    const taken = [...gs.players.values()].some(p => p.name.toLowerCase() === username.trim().toLowerCase());
    if (taken) return err(socket, 'Username already taken in this lobby');

    const playerId = uuidv4();
    gs.addPlayer(playerId, username.trim(), socket.id);
    lobbyManager.registerToken(token, gs.lobbyCode, playerId);
    socket.join(code);
    socket.emit('lobby:joined', { lobbyCode: code, playerId });
    broadcastLobby(gs);
    broadcastPublicLobbies();
  });

  socket.on('lobby:reconnect', ({ token }) => {
    const entry = lobbyManager.lookupToken(token);
    if (!entry) return err(socket, 'No session found for token');
    const gs = lobbyManager.getLobby(entry.lobbyCode);
    if (!gs) return err(socket, 'Lobby no longer exists');
    const ok = gs.reconnectPlayer(entry.playerId, socket.id);
    if (!ok) return err(socket, 'Player not found in lobby');
    socket.join(entry.lobbyCode);
    socket.emit('lobby:joined', { lobbyCode: entry.lobbyCode, playerId: entry.playerId, reconnected: true });
    broadcastLobby(gs);
  });

  // ── Explicit leave ─────────────────────────────────────────────────────
  // We mark the player disconnected but keep them in the roster so they
  // can rejoin via token. The round-viability check may abort an active round.
  socket.on('lobby:leave', ({ lobbyCode, playerId }) => {
    const gs = lobbyManager.getLobby(lobbyCode);
    if (!gs) return;
    gs.disconnectPlayer(playerId);
    socket.leave(lobbyCode);
    checkRoundViability(gs);
    broadcastLobby(gs);
    // Prune the lobby only if completely empty
    lobbyManager.pruneEmpty();
    broadcastPublicLobbies();
  });

  socket.on('settings:update', ({ lobbyCode, playerId, settings }) => {
    const gs = lobbyManager.getLobby(lobbyCode);
    if (!gs || gs.hostId !== playerId) return err(socket, 'Not authorised');
    const allowed = ['spyMode','spyCount','hintingTimeout','chameleonGuessTimeout','packTiers','chaosMode'];
    for (const k of allowed) {
      if (settings[k] !== undefined) gs.settings[k] = settings[k];
    }
    broadcastLobby(gs);
  });

  socket.on('round:start', ({ lobbyCode, playerId }) => {
    const gs = lobbyManager.getLobby(lobbyCode);
    if (!gs) return err(socket, 'Lobby not found');
    if (gs.hostId !== playerId) return err(socket, 'Only the host can start');
    // Remove disconnected players before starting
    for (const [pid, p] of gs.players) {
      if (!p.connected) gs.removePlayer(pid);
    }
    try {
      gs.startRound();
    } catch (e) {
      return err(socket, e.message);
    }
    broadcastLobby(gs);
    
    // Auto-transition from DEALING to HINTING after 3 seconds
    const dealingTimeout = setTimeout(() => {
      if (gs.phase === PHASES.DEALING) {
        gs.beginHinting();
        broadcastLobby(gs);
        
        // If hinting timeout is enabled, set up auto-transition to voting
        if (gs.settings.hintingTimeout > 0) {
          const hintingTimeout = setTimeout(() => {
            if (gs.phase === PHASES.HINTING) {
              gs.phase = PHASES.VOTING;
              io.to(gs.lobbyCode).emit('error:msg', `Hinting time expired. Moving to voting.`);
              broadcastLobby(gs);
            }
          }, gs.settings.hintingTimeout * 1000);
          gs.registerTimeout(hintingTimeout);
        }
      }
    }, 3000);
    gs.registerTimeout(dealingTimeout);
  });

  socket.on('hint:update', ({ lobbyCode, playerId, text }) => {
    const gs = lobbyManager.getLobby(lobbyCode);
    if (!gs || gs.phase !== PHASES.HINTING) return;
    gs.updateHint(playerId, text);
    if (gs.settings.spyMode === 'live') {
      const cham = gs.players.get(gs.chameleonId);
      if (cham?.socketId) {
        io.to(cham.socketId).emit('state:private', gs.privateState(gs.chameleonId));
      }
    }
  });

  socket.on('hint:submit', ({ lobbyCode, playerId }) => {
    const gs = lobbyManager.getLobby(lobbyCode);
    if (!gs || gs.phase !== PHASES.HINTING) return;
    const ok = gs.submitHint(playerId);
    if (!ok) return;

    if (gs.settings.spyMode === 'sealed') {
      const cham = gs.players.get(gs.chameleonId);
      if (cham?.socketId) {
        io.to(cham.socketId).emit('state:private', gs.privateState(gs.chameleonId));
      }
    }

    io.to(lobbyCode).emit('hint:submitted', { playerId });

    if (gs.allHintsSubmitted()) {
      gs.phase = PHASES.VOTING;
      broadcastLobby(gs);
    }
  });

  socket.on('vote:cast', ({ lobbyCode, playerId, targetId }) => {
    const gs = lobbyManager.getLobby(lobbyCode);
    if (!gs) return;

    // castVote validates both normal votes and Chaos Mode two-stage ballots.
    // In Chaos Mode, targetId is { count, suspects }; in normal mode it is a playerId.
    const ok = gs.castVote(playerId, targetId);
    if (!ok) return err(socket, 'Invalid vote');

    io.to(lobbyCode).emit('vote:cast', { voterId: playerId });
    broadcastLobby(gs);

    if (gs.allVotesCast()) {
      const result = gs.finalizeRound();

      if (gs.settings.chaosMode) {
        const caughtImposterId = gs.getChaosCaughtImposterId();

        // Chaos Mode fix: if an actual imposter receives a majority of suspect
        // selections, that imposter is caught and gets the same last-chance word
        // guess as the normal Chameleon. If no imposter is majority-caught, reveal.
        if (caughtImposterId) {
          gs.caughtImposterId = caughtImposterId;
          gs.chameleonId = caughtImposterId; // reuse the existing guess UI/socket flow
          gs.phase = PHASES.VOTING;
          gs.roundResult = null;

          const imposter = gs.players.get(caughtImposterId);
          if (imposter?.socketId) {
            io.to(imposter.socketId).emit('chameleon:guess_prompt');
          }

          const guessTimeout = setTimeout(() => {
            if (gs.phase !== PHASES.REVEAL) {
              gs.finalizeRound();
              broadcastLobby(gs);
            }
          }, gs.settings.chameleonGuessTimeout * 1000);
          gs.registerTimeout(guessTimeout);
          return;
        }

        broadcastLobby(gs);
        return;
      }

      if (result.chameleonCaught) {
        gs.phase = PHASES.VOTING;
        gs.roundResult = null;

        const cham = gs.players.get(gs.chameleonId);
        if (cham?.socketId) {
          io.to(cham.socketId).emit('chameleon:guess_prompt');
        }
        const guessTimeout = setTimeout(() => {
          if (gs.phase !== PHASES.REVEAL) {
            gs.finalizeRound();
            broadcastLobby(gs);
          }
        }, gs.settings.chameleonGuessTimeout * 1000);
        gs.registerTimeout(guessTimeout);
      } else {
        broadcastLobby(gs);
      }
    }
  });

  socket.on('chameleon:guess', ({ lobbyCode, playerId, word }) => {
    const gs = lobbyManager.getLobby(lobbyCode);
    if (!gs || gs.chameleonId !== playerId) return;
    gs.submitChameleonGuess(word);
    gs.finalizeRound();
    broadcastLobby(gs);
  });

  socket.on('round:end', ({ lobbyCode, playerId }) => {
    const gs = lobbyManager.getLobby(lobbyCode);
    if (!gs || gs.hostId !== playerId) return;
    gs.returnToLobby();
    broadcastLobby(gs);
    broadcastPublicLobbies();
  });

  socket.on('scores:reset', ({ lobbyCode, playerId }) => {
    const gs = lobbyManager.getLobby(lobbyCode);
    if (!gs || gs.hostId !== playerId) return;
    for (const p of gs.players.values()) p.score = 0;
    broadcastLobby(gs);
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    // Grace period: lets page-transition reconnects arrive before we act.
    // We still abort the round if the player hasn't reconnected after 3 s.
    setTimeout(() => {
      for (const gs of lobbyManager.lobbies.values()) {
        for (const [pid, p] of gs.players) {
          if (p.socketId === socket.id) {
            gs.disconnectPlayer(pid);
            checkRoundViability(gs);
            broadcastLobby(gs);
            break;
          }
        }
      }
      // Prune empty lobbies and lobbies where all players are offline
      lobbyManager.pruneEmpty();
      broadcastPublicLobbies();
    }, 3000);
  });
});