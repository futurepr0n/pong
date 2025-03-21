const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage for game rooms
const gameRooms = new Map();

// Debug mode
const DEBUG = true;

function logDebug(message, obj = null) {
  if (DEBUG) {
    if (obj) {
      console.log(`[DEBUG] ${message}`, obj);
    } else {
      console.log(`[DEBUG] ${message}`);
    }
  }
}

// Generate unique room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Helper function to get all active rooms
function getActiveRooms() {
  const rooms = [];
  for (const [roomId, room] of gameRooms.entries()) {
    const connectedPlayers = Object.values(room.players).filter(p => p.connected);
    rooms.push({
      id: roomId,
      status: room.status,
      players: connectedPlayers.length
    });
  }
  return rooms;
}

// Helper function to broadcast room updates
function broadcastRoomUpdate(roomId) {
  const room = gameRooms.get(roomId);
  if (!room) return;

  const players = Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    isHost: p.isHost
  }));

  io.to(roomId).emit('roomUpdate', {
    roomId: roomId,
    players: players,
    status: room.status
  });
}

// Socket.io connection handling
io.on('connection', (socket) => {
  logDebug(`Client connected: ${socket.id}`);
  
  // Create a new room
  socket.on('createRoom', (data) => {
    const roomId = generateRoomId();
    const hostToken = data.hostToken || Math.random().toString(36).substring(2, 15);
    
    logDebug(`Creating room: ${roomId} with host: ${socket.id}`);
    
    // Create new room in memory
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
      createdAt: Date.now()
    });
    
    // Add host as a player
    gameRooms.get(roomId).players[socket.id] = {
      id: socket.id,
      name: 'Host',
      connected: true,
      isHost: true
    };
    
    // Join the room socket
    socket.join(roomId);
    socket.currentRoom = roomId;
    
    logDebug(`Room created successfully: ${roomId}`);
    logDebug(`Current rooms:`, Array.from(gameRooms.keys()));
    
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
    
    // Handle joining as host
    if (isHost) {
      // Validate host token if provided
      if (hostToken && room.hostToken !== hostToken) {
        socket.emit('joinResponse', {
          success: false,
          message: 'Invalid host token',
          roomId: roomId
        });
        return;
      }
      
      // Join as host
      socket.join(roomId);
      socket.currentRoom = roomId;
      
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
    
    // Send game started event to all clients
    io.to(roomId).emit('gameStarted', {
      firstPlayer: firstPlayer.id,
      firstPlayerName: firstPlayer.name,
      gameState: room.gameState
    });
    
    // Track active player
    room.activePlayerId = firstPlayer.id;
    
    // Update room list (no longer joinable as new room)
    io.emit('roomList', getActiveRooms());
  });
  
  // Handle throw
  socket.on('throw', (data) => {
    const { roomId, velocity } = data;
    const room = gameRooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    
    // Forward throw to all clients in room
    socket.to(roomId).emit('throw', data);
  });
  
  // Handle cup hit
  socket.on('cupHit', (data) => {
    const { roomId, cupIndex, playerId, remainingCups } = data;
    const room = gameRooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    
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
    
    if (socket.currentRoom) {
      const roomId = socket.currentRoom;
      const room = gameRooms.get(roomId);
      
      if (room && room.players[socket.id]) {
        // Mark player as disconnected
        room.players[socket.id].connected = false;
        
        // If host disconnected and game is waiting, close the room
        const isHost = room.players[socket.id].isHost;
        
        if (isHost && room.status === 'waiting') {
          // Close room
          logDebug(`Host disconnected, closing room ${roomId}`);
          io.to(roomId).emit('roomClosed', { message: 'Host disconnected' });
          gameRooms.delete(roomId);
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
              // No more active players, reset game
              room.status = 'waiting';
              io.to(roomId).emit('gameReset');
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
      
      // Clean up completely empty rooms
      for (const [roomId, room] of gameRooms.entries()) {
        const connectedPlayers = Object.values(room.players).filter(p => p.connected);
        if (connectedPlayers.length === 0) {
          logDebug(`Removing empty room: ${roomId}`);
          gameRooms.delete(roomId);
        }
      }
      
      // Update room list
      io.emit('roomList', getActiveRooms());
    }
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/game.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/controller.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

// Start the server
const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open a browser and navigate to http://localhost:${PORT}`);
});