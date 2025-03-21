const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Configuration
const CONFIG = {
  // The base URL for generating QR codes and links
  BASE_URL: process.env.BASE_URL || 'https://pong.futurepr0n.com',
  
  // How long rooms stay active without a host (in milliseconds)
  ROOM_GRACE_PERIOD: 5 * 60 * 1000, // 5 minutes
  
  // How often to check for expired rooms (in milliseconds)
  CLEANUP_INTERVAL: 60 * 1000, // 1 minute
  
  // Debug mode for verbose logging
  DEBUG: true
};

// Storage for game rooms (will persist across socket connections)
const gameRooms = new Map();

// Debug logging
function logDebug(message, obj = null) {
  if (CONFIG.DEBUG) {
    if (obj) {
      console.log(`[DEBUG] ${message}`, obj);
    } else {
      console.log(`[DEBUG] ${message}`);
    }
  }
}

// Generate unique room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Get list of active rooms for the lobby
function getActiveRooms() {
  const rooms = [];
  const now = Date.now();
  
  for (const [roomId, room] of gameRooms.entries()) {
    // Skip rooms that are expired or in grace period
    if (room.status === 'closed' || (room.hostDisconnectedAt && now - room.hostDisconnectedAt > CONFIG.ROOM_GRACE_PERIOD)) {
      continue;
    }
    
    // Count connected players that are not hosts
    const connectedPlayers = Object.values(room.players).filter(p => p.connected && !p.isHost);
    
    rooms.push({
      id: roomId,
      status: room.status,
      players: connectedPlayers.length
    });
  }
  
  return rooms;
}

// Clean up expired rooms
function cleanupExpiredRooms() {
  const now = Date.now();
  let cleanupCount = 0;
  
  for (const [roomId, room] of gameRooms.entries()) {
    // Remove rooms where host has been disconnected beyond grace period
    if (room.hostDisconnectedAt && now - room.hostDisconnectedAt > CONFIG.ROOM_GRACE_PERIOD) {
      gameRooms.delete(roomId);
      cleanupCount++;
      logDebug(`Removed expired room ${roomId} (host disconnected for too long)`);
    }
    
    // Also clean up very old rooms (24 hours)
    if (now - room.createdAt > 24 * 60 * 60 * 1000) {
      gameRooms.delete(roomId);
      cleanupCount++;
      logDebug(`Removed room ${roomId} (older than 24 hours)`);
    }
  }
  
  if (cleanupCount > 0) {
    logDebug(`Cleaned up ${cleanupCount} expired rooms`);
  }
}

// Setup cleanup interval
setInterval(cleanupExpiredRooms, CONFIG.CLEANUP_INTERVAL);

// Helper to broadcast room updates to all clients in a room
function broadcastRoomUpdate(roomId) {
  const room = gameRooms.get(roomId);
  if (!room) return;
  
  // Convert players object to array for client consumption
  const playersList = Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    isHost: p.isHost
  }));
  
  // Get just the connected non-host players for the count
  const connectedPlayerCount = playersList.filter(p => p.connected && !p.isHost).length;
  
  logDebug(`Broadcasting room update for ${roomId}, ${connectedPlayerCount} connected players`);
  
  // Send update to all clients in the room
  io.to(roomId).emit('roomUpdate', {
    roomId: roomId,
    players: playersList,
    playerCount: connectedPlayerCount,
    status: room.status
  });
  
  // Also update the room list for all clients in the lobby
  io.emit('roomList', getActiveRooms());
}

// Express routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/game.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/controller.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
  logDebug(`Client connected: ${socket.id}`);
  
  // Create a new room
  socket.on('createRoom', (data) => {
    // Generate a unique room ID
    let roomId;
    do {
      roomId = generateRoomId();
    } while (gameRooms.has(roomId));
    
    const hostToken = data.hostToken || Math.random().toString(36).substring(2, 15);
    
    logDebug(`Creating room: ${roomId} with host: ${socket.id}`);
    
    // Create new room with persistent data
    gameRooms.set(roomId, {
      id: roomId,
      hostToken: hostToken,
      status: 'waiting',
      players: {},
      gameState: {
        round: 1,
        cups: {},
        scores: {}
      },
      createdAt: Date.now(),
      lastActivity: Date.now(),
      hostDisconnectedAt: null // Track when host disconnects
    });
    
    // Add host as a player
    gameRooms.get(roomId).players[socket.id] = {
      id: socket.id,
      name: 'Host',
      connected: true,
      isHost: true
    };
    
    // Join the socket room
    socket.join(roomId);
    socket.currentRoom = roomId;
    
    logDebug(`Room created successfully: ${roomId}`);
    logDebug(`Current rooms:`, Array.from(gameRooms.keys()));
    
    // Store room ID on socket for reconnection logic
    socket.hostRoom = roomId;
    
    // Send room creation response
    socket.emit('roomCreated', {
      roomId: roomId,
      hostToken: hostToken
    });
    
    console.log(`Room created: ${roomId} by ${socket.id}`);
    
    // Update room list for all clients in lobby
    io.emit('roomList', getActiveRooms());
  });
  
  // Get Room List
  socket.on('getRoomList', () => {
    const activeRooms = getActiveRooms();
    logDebug(`Sending room list:`, activeRooms);
    socket.emit('roomList', activeRooms);
  });
  
  // Join an existing room
  socket.on('joinRoom', (data) => {
    const { roomId, name, isController, isHost, isSpectator, hostToken } = data;
    
    logDebug(`Join request for room ${roomId} by ${socket.id} as ${isHost ? 'host' : (isController ? 'controller' : 'spectator')}`);
    logDebug(`Available rooms:`, Array.from(gameRooms.keys()));
    
    // Validate room exists
    const room = gameRooms.get(roomId);
    if (!room) {
      logDebug(`Room not found: ${roomId}`);
      console.error(`Room not found: ${roomId}`);
      socket.emit('joinResponse', { 
        success: false, 
        message: 'Room not found. It may have expired or been closed.',
        roomId: roomId 
      });
      return;
    }
    
    logDebug(`Room ${roomId} found, processing join request`);
    
    // Update room activity timestamp
    room.lastActivity = Date.now();
    
    // Handle joining as host
    if (isHost) {
      // Clear host disconnection time since we have a host now
      room.hostDisconnectedAt = null;
      
      // Validate host token if provided
      if (hostToken && room.hostToken !== hostToken) {
        socket.emit('joinResponse', {
          success: false,
          message: 'Invalid host token',
          roomId: roomId
        });
        return;
      }
      
      // Join socket room
      socket.join(roomId);
      socket.currentRoom = roomId;
      socket.hostRoom = roomId; // Track that this is a host socket
      
      // If host is reconnecting, update their connection status
      if (room.players[socket.id]) {
        room.players[socket.id].connected = true;
      } else {
        // Add new host (should only happen if original host disconnected)
        room.players[socket.id] = {
          id: socket.id,
          name: 'Host',
          connected: true,
          isHost: true
        };
      }
      
      logDebug(`Host joined room ${roomId} successfully`);
      
      // Send success response
      socket.emit('joinResponse', {
        success: true,
        roomId: roomId,
        isHost: true,
        gameState: room.status === 'playing' ? room.gameState : null
      });
      
      // Broadcast room update
      broadcastRoomUpdate(roomId);
      return;
    }
    
    // Handle joining as spectator
    if (isSpectator) {
      socket.join(roomId);
      socket.currentRoom = roomId;
      
      logDebug(`Spectator joined room ${roomId}`);
      
      socket.emit('joinResponse', {
        success: true,
        roomId: roomId,
        isSpectator: true,
        gameState: room.status === 'playing' ? room.gameState : null
      });
      
      return;
    }
    
    // Handle joining as controller (player)
    if (isController) {
      const playerName = name || `Player ${Object.keys(room.players).length + 1}`;
      
      // Check if we already have this player
      if (room.players[socket.id]) {
        // Update existing player
        room.players[socket.id].connected = true;
        room.players[socket.id].name = playerName;
      } else {
        // Add new player
        room.players[socket.id] = {
          id: socket.id,
          name: playerName,
          connected: true,
          isHost: false
        };
        
        // Initialize cup state for new player
        room.gameState.cups[socket.id] = Array(6).fill(true);
      }
      
      // Join socket room
      socket.join(roomId);
      socket.currentRoom = roomId;
      
      logDebug(`Controller joined room ${roomId} as ${playerName}`);
      
      // Send success response
      socket.emit('joinResponse', {
        success: true,
        roomId: roomId,
        playerInfo: room.players[socket.id],
        gameState: room.status === 'playing' ? room.gameState : null
      });
      
      // Broadcast room update
      broadcastRoomUpdate(roomId);
      
      // Log the current players in the room for debugging
      const connectedPlayers = Object.values(room.players).filter(p => p.connected && !p.isHost);
      logDebug(`Room ${roomId} now has ${connectedPlayers.length} connected players (excluding host)`);
      
      return;
    }
    
    // If we get here, the request didn't specify a valid join type
    socket.emit('joinResponse', {
      success: false,
      message: 'Invalid join request',
      roomId: roomId
    });
  });
  
  // Start Game
  socket.on('startGame', (roomId) => {
    const room = gameRooms.get(roomId);
    if (!room) {
      logDebug(`Start game request for non-existent room: ${roomId}`);
      return;
    }
    
    logDebug(`Start game requested for room ${roomId} by ${socket.id}`);
    
    // Check if socket is host
    const player = room.players[socket.id];
    if (!player || !player.isHost) {
      socket.emit('error', 'Only the host can start the game');
      return;
    }
    
    // Get active players
    const activePlayers = Object.values(room.players).filter(p => p.connected && !p.isHost);
    
    logDebug(`Room ${roomId} has ${activePlayers.length} active players ready to start`);
    
    if (activePlayers.length === 0) {
      socket.emit('error', 'Need at least one player to start');
      return;
    }
    
    // Set game to playing state
    room.status = 'playing';
    
    // Select first player randomly
    const firstPlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)];
    
    // Initialize cup states for all players if not already done
    activePlayers.forEach(player => {
      if (!room.gameState.cups[player.id]) {
        room.gameState.cups[player.id] = Array(6).fill(true);
      }
      // Initialize scores
      room.gameState.scores[player.id] = 0;
    });
    
    logDebug(`Game starting in room ${roomId}, first player: ${firstPlayer.name}`);
    
    // Track active player
    room.activePlayerId = firstPlayer.id;
    
    // Send game started event to all clients
    io.to(roomId).emit('gameStarted', {
      firstPlayer: firstPlayer.id,
      firstPlayerName: firstPlayer.name,
      gameState: room.gameState
    });
    
    // Update room list (no longer joinable as new room)
    io.emit('roomList', getActiveRooms());
  });
  
  // Handle throw
  socket.on('throw', (data) => {
    const { roomId, velocity } = data;
    const room = gameRooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    
    // Update activity timestamp
    room.lastActivity = Date.now();
    
    // Forward throw to all clients in room
    socket.to(roomId).emit('throw', data);
  });
  
  // Handle cup hit
  socket.on('cupHit', (data) => {
    const { roomId, cupIndex, playerId, remainingCups } = data;
    const room = gameRooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    
    // Update activity timestamp
    room.lastActivity = Date.now();
    
    // Update cup state
    if (room.gameState.cups[playerId]) {
      room.gameState.cups[playerId][cupIndex] = false;
      
      // Check if player has lost (all cups hit)
      const playerLost = room.gameState.cups[playerId].every(cup => !cup);
      
      // Get the active player who made the throw (not the one who was hit)
      const activePlayers = Object.values(room.players)
        .filter(p => p.connected && !p.isHost)
        .filter(p => p.id !== playerId); // Exclude the player who was hit
      
      if (activePlayers.length > 0) {
        const activePlayer = activePlayers[0];
        // Award a point to the active player
        room.gameState.scores[activePlayer.id] = (room.gameState.scores[activePlayer.id] || 0) + 1;
      }
      
      if (playerLost) {
        // Check if game is over
        const winner = Object.entries(room.gameState.scores)
          .sort((a, b) => b[1] - a[1])
          .map(([id, score]) => ({ id, score }))[0];
        
        if (winner) {
          const winningPlayer = room.players[winner.id];
          io.to(roomId).emit('playerWon', {
            player: winningPlayer,
            isTie: false,
            scores: room.gameState.scores
          });
          room.status = 'ended';
        }
      } else {
        // Change turn
        const activePlayer = Object.values(room.players)
          .find(p => p.connected && p.id === playerId);
        
        if (activePlayer) {
          room.activePlayerId = activePlayer.id;
          
          io.to(roomId).emit('turnChange', {
            activePlayer: activePlayer,
            gameState: room.gameState
          });
        }
      }
    }
  });
  
  // Handle cup miss
  socket.on('cupMiss', (data) => {
    const { roomId } = data;
    const room = gameRooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    
    // Update activity timestamp
    room.lastActivity = Date.now();
    
    // Find next player for turn
    const activePlayers = Object.values(room.players)
      .filter(p => p.connected && !p.isHost);
    
    if (activePlayers.length >= 2) {
      // Find current active player index
      const currentActiveIdx = activePlayers.findIndex(p => p.id === room.activePlayerId);
      const nextIdx = (currentActiveIdx + 1) % activePlayers.length;
      const nextPlayer = activePlayers[nextIdx];
      
      // Update active player
      room.activePlayerId = nextPlayer.id;
      
      // Send turn change event
      io.to(roomId).emit('turnChange', {
        activePlayer: nextPlayer,
        gameState: room.gameState
      });
    }
  });
  
  // Reset game
  socket.on('resetGame', (roomId) => {
    const room = gameRooms.get(roomId);
    if (!room) return;
    
    // Check if socket is host
    const player = room.players[socket.id];
    if (!player || !player.isHost) {
      socket.emit('error', 'Only the host can reset the game');
      return;
    }
    
    logDebug(`Resetting game in room ${roomId}`);
    
    // Reset game state
    room.status = 'waiting';
    room.gameState = {
      round: 1,
      cups: {},
      scores: {}
    };
    
    // Reset cup states for all players
    Object.keys(room.players).forEach(playerId => {
      room.gameState.cups[playerId] = Array(6).fill(true);
    });
    
    // Notify all clients
    io.to(roomId).emit('gameReset');
    
    // Update room list (now joinable again)
    io.emit('roomList', getActiveRooms());
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    logDebug(`Client disconnected: ${socket.id}`);
    
    // Handle normal disconnection
    if (socket.currentRoom) {
      const roomId = socket.currentRoom;
      const room = gameRooms.get(roomId);
      
      if (room && room.players[socket.id]) {
        // Mark player as disconnected
        room.players[socket.id].connected = false;
        
        // If host disconnected, start grace period but DON'T close the room
        const isHost = room.players[socket.id].isHost;
        
        if (isHost) {
          logDebug(`Host disconnected from room ${roomId}, starting grace period`);
          room.hostDisconnectedAt = Date.now();
        } else if (room.status === 'playing') {
          // Handle player disconnect during game
          // If active player disconnected, switch to next
          const currentActiveId = room.activePlayerId;
          
          if (currentActiveId === socket.id) {
            // Find next player
            const activePlayers = Object.values(room.players)
              .filter(p => p.connected && !p.isHost);
            
            if (activePlayers.length > 0) {
              const nextPlayer = activePlayers[0];
              room.activePlayerId = nextPlayer.id;
              
              io.to(roomId).emit('playerDisconnected', {
                playerId: socket.id,
                activePlayer: nextPlayer
              });
            } else {
              // No more active players, but don't reset yet
              io.to(roomId).emit('playerDisconnected', {
                playerId: socket.id,
                message: 'All players disconnected'
              });
            }
          } else {
            // Not active player, just notify
            io.to(roomId).emit('playerDisconnected', {
              playerId: socket.id
            });
          }
        }
        
        // Broadcast room update
        broadcastRoomUpdate(roomId);
      }
    }
    
    // Update room list
    io.emit('roomList', getActiveRooms());
  });
});

// Start the server
const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open a browser and navigate to ${CONFIG.BASE_URL || `http://localhost:${PORT}`}`);
});