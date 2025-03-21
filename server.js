const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Serve static files from the public directory
app.use(express.static('public'));

// Game rooms storage
const gameRooms = new Map();

// Base URL for QR codes - use environment variable or default to localhost
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

// Helper function to generate room ID (without using uuid)
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Helper function to get room data safe for client
function getRoomData(room) {
  return {
    id: room.id,
    players: room.players.map(p => ({ 
      id: p.id, 
      name: p.name,
      connected: p.connected 
    })),
    activePlayerIndex: room.activePlayerIndex,
    status: room.status
  };
}

// Room cleanup - remove inactive rooms after 1 hour
function cleanupRooms() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  for (const [roomId, room] of gameRooms.entries()) {
    // Delete rooms created more than 1 hour ago
    if (room.created && now - room.created > ONE_HOUR) {
      io.to(roomId).emit('roomClosed', { reason: 'Room timed out' });
      gameRooms.delete(roomId);
      console.log(`Room ${roomId} removed due to timeout`);
    }
  }
}

// Run cleanup every 15 minutes
setInterval(cleanupRooms, 15 * 60 * 1000);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Handle room creation
  socket.on('createRoom', () => {
    const roomId = generateRoomId();
    const joinUrl = `${BASE_URL}/controller.html?room=${roomId}`;
    
    gameRooms.set(roomId, {
      id: roomId,
      host: socket.id,
      players: [],
      spectators: [],
      status: 'waiting',
      activePlayerIndex: 0,
      gameState: {
        cups: {},  // Map of playerID to cup states
        scores: {},
        round: 1
      },
      created: Date.now() // Add timestamp for room cleanup
    });
    
    socket.join(roomId);
    socket.currentRoom = roomId; // Store room ID on socket for disconnect handling
    
    socket.emit('roomCreated', {
      roomId: roomId, 
      joinUrl: joinUrl,
      players: []
    });
    
    // Broadcast updated room list to all clients in lobby
    io.emit('roomList', Array.from(gameRooms.values())
      .filter(room => room.status === 'waiting')
      .map(r => getRoomData(r)));
    
    console.log(`Room created: ${roomId} by ${socket.id}`);
  });
  
  // Handle getting room list
  socket.on('getRoomList', () => {
    socket.emit('roomList', Array.from(gameRooms.values())
      .filter(room => room.status === 'waiting')
      .map(r => getRoomData(r)));
  });
  
  // Handle player joining a room
  socket.on('joinRoom', (data) => {
    const { roomId, name, isController, isHost } = data;
    const room = gameRooms.get(roomId);
    
    if (!room) {
      socket.emit('joinResponse', { success: false, message: 'Room not found' });
      return;
    }
    
    if (room.status === 'playing' && isController) {
      // Check if this is a reconnect for an existing player
      const existingPlayer = room.players.find(p => p.id === socket.id);
      if (!existingPlayer) {
        socket.emit('joinResponse', { success: false, message: 'Game already started' });
        return;
      }
    }
    
    socket.join(roomId);
    socket.currentRoom = roomId; // Store room ID on socket for disconnect handling
    
    if (isController) {
      // Check if we're at max capacity
      if (room.players.filter(p => p.connected).length >= 10 && 
          !room.players.some(p => p.id === socket.id)) {
        socket.emit('joinResponse', { success: false, message: 'Room is full' });
        return;
      }
      
      // Check if player is rejoining
      const existingPlayerIndex = room.players.findIndex(p => p.id === socket.id);
      let playerInfo;
      
      if (existingPlayerIndex >= 0) {
        // Player is rejoining
        playerInfo = room.players[existingPlayerIndex];
        playerInfo.connected = true;
        if (name && name !== playerInfo.name) {
          playerInfo.name = name; // Update name if provided and different
        }
      } else {
        // New player joining
        playerInfo = {
          id: socket.id,
          name: name || `Player ${room.players.length + 1}`,
          connected: true
        };
        room.players.push(playerInfo);
        
        // Initialize player's cup state and score
        if (!room.gameState.cups[socket.id]) {
          room.gameState.cups[socket.id] = Array(6).fill(true);
        }
        if (!room.gameState.scores[socket.id]) {
          room.gameState.scores[socket.id] = 0;
        }
      }
      
      socket.emit('joinResponse', { 
        success: true, 
        roomId: roomId,
        playerInfo: playerInfo,
        isController: true,
        gameState: room.status === 'playing' ? room.gameState : null
      });
      
      // Notify host about new player
      io.to(room.host).emit('playerCountUpdate', {
        roomId: roomId,
        count: room.players.filter(p => p.connected).length
      });
      
      console.log(`Player ${playerInfo.name} (${socket.id}) joined room ${roomId}`);
    } else {
      // Host or spectator joining
      if (isHost) {
        // Update host ID
        room.host = socket.id;
      } else {
        // Add spectator if not already in the list
        if (!room.spectators.includes(socket.id)) {
          room.spectators.push(socket.id);
        }
      }
      
      socket.emit('joinResponse', {
        success: true,
        roomId: roomId,
        isHost: isHost || false,
        isSpectator: !isHost,
        gameState: room.gameState
      });
      
      console.log(`${isHost ? 'Host' : 'Spectator'} ${socket.id} joined room ${roomId}`);
    }
    
    // Send updated room info to all in the room
    io.to(roomId).emit('roomUpdate', {
      ...getRoomData(room),
      activePlayer: room.status === 'playing' ? room.players[room.activePlayerIndex] : null
    });
    
    // Update room list for lobby
    io.emit('roomList', Array.from(gameRooms.values())
      .filter(room => room.status === 'waiting')
      .map(r => getRoomData(r)));
  });
  
  // Handle rejoining a room (for hosts that got disconnected)
  socket.on('rejoinRoom', (roomId) => {
    const room = gameRooms.get(roomId);
    
    if (room) {
      // Update host ID 
      room.host = socket.id;
      socket.join(roomId);
      socket.currentRoom = roomId;
      
      socket.emit('joinResponse', {
        success: true,
        roomId: roomId,
        isHost: true,
        gameState: room.gameState
      });
      
      // Send updated room info
      io.to(roomId).emit('roomUpdate', {
        ...getRoomData(room),
        activePlayer: room.status === 'playing' ? room.players[room.activePlayerIndex] : null
      });
    } else {
      socket.emit('joinResponse', { success: false, message: 'Room not found' });
    }
  });
  
  // Handle periodic room ping to keep it active
  socket.on('pingRoom', (roomId) => {
    const room = gameRooms.get(roomId);
    if (room) {
      room.lastPing = Date.now();
    }
  });

// Handle starting the game
socket.on('startGame', (roomId) => {
  const room = gameRooms.get(roomId);
  
  if (!room) return;
  
  if (socket.id !== room.host) {
    socket.emit('error', 'Only the host can start the game');
    return;
  }
  
  // Allow game with at least one player
  if (room.players.filter(p => p.connected).length === 0) {
    socket.emit('error', 'Cannot start game without players');
    return;
  }
  
  // Update room status
  room.status = 'playing';
  room.activePlayerIndex = 0;
  
  // Make sure first player is connected
  while (!room.players[room.activePlayerIndex].connected) {
    room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
  }
  
  const firstPlayer = room.players[room.activePlayerIndex];
  
  // Notify all clients in the room
  io.to(roomId).emit('gameStarted', {
    roomId: roomId,
    firstPlayer: firstPlayer.id,
    firstPlayerName: firstPlayer.name
  });
  
  console.log(`Game started in room ${roomId}`);
  
  // Update room list for lobby (remove this room from available rooms)
  io.emit('roomList', Array.from(gameRooms.values())
    .filter(room => room.status === 'waiting')
    .map(r => getRoomData(r)));
});

// Handle throwing the ball
socket.on('throw', (data) => {
  const roomId = data.roomId;
  const room = gameRooms.get(roomId);
  
  if (!room || room.status !== 'playing') return;
  
  // Check if it's this player's turn
  const activePlayer = room.players[room.activePlayerIndex];
  if (socket.id !== activePlayer.id) {
    socket.emit('error', 'Not your turn');
    return;
  }
  
  // Broadcast throw data to game screen
  io.to(roomId).emit('throw', {
    playerId: socket.id,
    velocity: data.velocity
  });
});

// Handle cup hit result
socket.on('cupHit', (data) => {
  const { roomId, cupIndex, playerId, remainingCups } = data;
  const room = gameRooms.get(roomId);
  
  if (!room || room.status !== 'playing') return;
  
  // Get the current player
  const activePlayer = room.players[room.activePlayerIndex];
  const currentPlayer = activePlayer.id;
  
  // Verify this is for the correct player
  if (playerId !== currentPlayer) {
    console.error(`Cup hit mismatch: ${playerId} vs ${currentPlayer}`);
    return;
  }
  
  // Update the cup state for the current active player
  const cups = room.gameState.cups[activePlayer.id];
  
  if (cups && cupIndex >= 0 && cupIndex < cups.length) {
    cups[cupIndex] = false;
    
    // Update score
    room.gameState.scores[activePlayer.id] = (room.gameState.scores[activePlayer.id] || 0) + 1;
    
    // Check if all cups are hit
    const allCupsHit = cups.every(cup => !cup);
    
    if (allCupsHit) {
      // This player has knocked out all their cups
      console.log(`Player ${activePlayer.name} has eliminated all cups`);
      
      // Check if we need to continue the round for other players
      // In first round, all players get a chance to play
      // In subsequent rounds, we continue until someone wins
      const playersInCurrentRound = [];
      
      if (room.gameState.round === 1) {
        // Find players who haven't had their turn yet in the first round
        let nextIndex = (room.activePlayerIndex + 1) % room.players.length;
        while (nextIndex !== room.activePlayerIndex) {
          if (room.players[nextIndex].connected) {
            playersInCurrentRound.push(room.players[nextIndex]);
          }
          nextIndex = (nextIndex + 1) % room.players.length;
        }
      }
      
      if (playersInCurrentRound.length > 0) {
        // Continue the round to give other players a chance
        console.log(`Continuing round for ${playersInCurrentRound.length} more player(s)`);
        
        // Move to next player
        const isEndOfRound = advanceToNextPlayer(room);
        
        // Notify all clients about player finishing
        io.to(roomId).emit('playerFinished', {
          player: activePlayer,
          nextPlayer: room.players[room.activePlayerIndex],
          potentialTie: true
        });
        
        // Notify all clients about turn change
        io.to(roomId).emit('turnChange', {
          activePlayer: room.players[room.activePlayerIndex],
          gameState: room.gameState
        });
      } else {
        // This player has won
        io.to(roomId).emit('playerWon', {
          player: activePlayer,
          scores: room.gameState.scores,
          isTie: false
        });
        
        // End the game
        room.status = 'completed';
      }
    } else {
      // Move to next player's turn
      advanceToNextPlayer(room);
      
      // Notify all clients
      io.to(roomId).emit('turnChange', {
        activePlayer: room.players[room.activePlayerIndex],
        gameState: room.gameState
      });
    }
  }
});

// Handle cup miss
socket.on('cupMiss', (data) => {
  const { roomId } = data;
  const room = gameRooms.get(roomId);
  
  if (!room || room.status !== 'playing') return;
  
  // Get the current player before advancing
  const currentPlayer = room.players[room.activePlayerIndex];
  
  // Move to next player's turn
  const isEndOfRound = advanceToNextPlayer(room);
  
  // Check if we're starting a new round
  if (isEndOfRound) {
    room.gameState.round++;
    console.log(`Starting round ${room.gameState.round}`);
    
    // Check if any player has no cups left (winner)
    let winner = null;
    let tiedPlayers = [];
    
    for (const player of room.players) {
      if (player.connected) {
        const cups = room.gameState.cups[player.id];
        if (cups && cups.every(cup => !cup)) {
          if (!winner) {
            winner = player;
          } else {
            tiedPlayers.push(player);
          }
        }
      }
    }
    
    if (winner) {
      if (tiedPlayers.length > 0) {
        // We have a tie
        io.to(roomId).emit('playerWon', {
          player: winner,
          tiedPlayers: [winner, ...tiedPlayers],
          scores: room.gameState.scores,
          isTie: true
        });
      } else {
        // Clear winner
        io.to(roomId).emit('playerWon', {
          player: winner,
          scores: room.gameState.scores,
          isTie: false
        });
      }
      
      // End the game
      room.status = 'completed';
      return;
    }
    
    // Notify all clients about the new round
    io.to(roomId).emit('newRound', {
      round: room.gameState.round,
      activePlayer: room.players[room.activePlayerIndex]
    });
  }
  
  // Notify all clients about turn change
  io.to(roomId).emit('turnChange', {
    activePlayer: room.players[room.activePlayerIndex],
    gameState: room.gameState,
    previousPlayer: currentPlayer
  });
});

// Handle game reset
socket.on('resetGame', (roomId) => {
  const room = gameRooms.get(roomId);
  
  if (!room) return;
  
  if (socket.id !== room.host) {
    socket.emit('error', 'Only the host can reset the game');
    return;
  }
  
  // Reset game state
  room.status = 'waiting';
  room.activePlayerIndex = 0;
  room.gameState = {
    cups: {},
    scores: {},
    round: 1
  };
  
  // Reinitialize all player cup states
  room.players.forEach(player => {
    room.gameState.cups[player.id] = Array(6).fill(true);
    room.gameState.scores[player.id] = 0;
  });
  
  // Notify all clients in the room
  io.to(roomId).emit('gameReset', {
    roomId: roomId
  });
  
  console.log(`Game reset in room ${roomId}`);
  
  // Update room list for lobby (add this room back to available rooms)
  io.emit('roomList', Array.from(gameRooms.values())
    .filter(room => room.status === 'waiting')
    .map(r => getRoomData(r)));
});

// Handle closing a room
socket.on('closeRoom', (roomId) => {
  const room = gameRooms.get(roomId);
  
  if (room && (socket.id === room.host)) {
    io.to(roomId).emit('roomClosed', { reason: 'Host closed the room' });
    gameRooms.delete(roomId);
    
    // Update room list for all clients
    io.emit('roomList', Array.from(gameRooms.values())
      .filter(room => room.status === 'waiting')
      .map(r => getRoomData(r)));
    
    console.log(`Room ${roomId} closed by host ${socket.id}`);
  }
});

// Handle disconnection
socket.on('disconnect', () => {
  console.log(`Client disconnected: ${socket.id}`);
  
  // Get the room this socket was in (if any)
  const roomId = socket.currentRoom;
  if (!roomId) return;
  
  const room = gameRooms.get(roomId);
  if (!room) return;
  
  // Check if the client was a host
  if (room.host === socket.id) {
    // Host disconnected
    // For now, let the room continue, but mark it as having a disconnected host
    room.hostConnected = false;
    console.log(`Host disconnected from room ${roomId}`);
    
    // If there are no players or spectators, close the room
    if (room.players.length === 0 && room.spectators.length === 0) {
      gameRooms.delete(roomId);
      console.log(`Room ${roomId} closed because host disconnected and no players remained`);
    }
  } 
  // Check if client was a player in the room
  else if (room.players.some(p => p.id === socket.id)) {
    // Mark player as disconnected
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex >= 0) {
      room.players[playerIndex].connected = false;
      
      // If it was the active player's turn, move to the next player
      if (room.activePlayerIndex === playerIndex && room.status === 'playing') {
        const isEndOfRound = advanceToNextPlayer(room);
        
        // Handle end of round if necessary
        if (isEndOfRound && room.status === 'playing') {
          room.gameState.round++;
          
          // Notify clients about new round
          io.to(roomId).emit('newRound', {
            round: room.gameState.round,
            activePlayer: room.players[room.activePlayerIndex]
          });
        }
      }
      
      // Notify all clients in the room
      io.to(roomId).emit('playerDisconnected', {
        playerId: socket.id,
        playerName: room.players[playerIndex].name,
        activePlayer: room.players[room.activePlayerIndex]
      });
      
      // Update host about player count
      if (room.host) {
        io.to(room.host).emit('playerCountUpdate', {
          roomId: roomId,
          count: room.players.filter(p => p.connected).length
        });
      }
      
      console.log(`Player ${room.players[playerIndex].name} disconnected from room ${roomId}`);
      
      // If all players disconnected and the game was in progress, end it
      const connectedPlayers = room.players.filter(p => p.connected);
      if (connectedPlayers.length === 0 && room.status === 'playing') {
        room.status = 'waiting';
        console.log(`Game ended in room ${roomId} because all players disconnected`);
      }
      
      // If only one player remains and game was in progress, declare them the winner
      if (connectedPlayers.length === 1 && room.status === 'playing') {
        const lastPlayer = connectedPlayers[0];
        io.to(roomId).emit('playerWon', {
          player: lastPlayer,
          scores: room.gameState.scores,
          isTie: false,
          reason: 'All other players disconnected'
        });
        room.status = 'completed';
      }
    }
  }
  // Check if client was a spectator
  else if (room.spectators.includes(socket.id)) {
    room.spectators = room.spectators.filter(id => id !== socket.id);
    console.log(`Spectator ${socket.id} disconnected from room ${roomId}`);
  }
  
  // If the room is completely empty, close it
  if (room.players.filter(p => p.connected).length === 0 && 
      room.spectators.length === 0 &&
      !room.hostConnected) {
    gameRooms.delete(roomId);
    console.log(`Room ${roomId} closed because all clients disconnected`);
  }
  
  // Update room list for lobby
  io.emit('roomList', Array.from(gameRooms.values())
    .filter(room => room.status === 'waiting')
    .map(r => getRoomData(r)));
});
});

// Helper function to advance to the next player's turn
// Returns true if we've completed a full round
function advanceToNextPlayer(room) {
const connectedPlayers = room.players.filter(p => p.connected);
if (connectedPlayers.length === 0) return false;

const startingIndex = room.activePlayerIndex;
let nextIndex = (room.activePlayerIndex + 1) % room.players.length;

// Skip disconnected players
while (!room.players[nextIndex].connected) {
  nextIndex = (nextIndex + 1) % room.players.length;
  
  // If we've checked all players and come back to the starting index,
  // there's only one connected player
  if (nextIndex === startingIndex) {
    return false;
  }
}

room.activePlayerIndex = nextIndex;

// If we've gone back to the first player, we've completed a round
return nextIndex < startingIndex || (nextIndex === 0 && startingIndex === room.players.length - 1);
}

// Start the server
const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
console.log(`Open a browser and navigate to http://localhost:${PORT}`);
});

