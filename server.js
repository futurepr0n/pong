const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');

// Serve static files from the current directory
app.use(express.static('.'));

// Game rooms storage
const gameRooms = new Map();

// Helper function to generate room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Helper function to get room data safe for client
function getRoomData(room) {
  return {
    id: room.id,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    activePlayerIndex: room.activePlayerIndex,
    status: room.status
  };
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Handle room creation
  socket.on('createRoom', () => {
    const roomId = generateRoomId();
    const joinUrl = `${process.env.BASE_URL || `http://localhost:${PORT}`}/controller.html?room=${roomId}`;
    
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
      }
    });
    
    socket.join(roomId);
    
    socket.emit('roomCreated', {
      roomId: roomId, 
      joinUrl: joinUrl,
      players: []
    });
    
    // Broadcast updated room list to all clients
    io.emit('roomList', Array.from(gameRooms.values()).map(r => getRoomData(r)));
    
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
    const { roomId, name, isController } = data;
    const room = gameRooms.get(roomId);
    
    if (!room) {
      socket.emit('joinResponse', { success: false, message: 'Room not found' });
      return;
    }
    
    if (room.status !== 'waiting' && isController) {
      socket.emit('joinResponse', { success: false, message: 'Game already started' });
      return;
    }
    
    socket.join(roomId);
    
    if (isController) {
      // Check if we're at max capacity
      if (room.players.length >= 10) {
        socket.emit('joinResponse', { success: false, message: 'Room is full' });
        return;
      }
      
      // Add player to the room
      const playerInfo = {
        id: socket.id,
        name: name || `Player ${room.players.length + 1}`,
        connected: true
      };
      
      room.players.push(playerInfo);
      
      // Initialize player's cup state
      room.gameState.cups[socket.id] = Array(6).fill(true);
      room.gameState.scores[socket.id] = 0;
      
      socket.emit('joinResponse', { 
        success: true, 
        roomId: roomId,
        playerInfo: playerInfo,
        isController: true
      });
      
      // Notify host about new player
      io.to(room.host).emit('playerCountUpdate', {
        roomId: roomId,
        count: room.players.length
      });
      
      console.log(`Player ${socket.id} joined room ${roomId}`);
    } else {
      // Add spectator
      room.spectators.push(socket.id);
      
      socket.emit('joinResponse', {
        success: true,
        roomId: roomId,
        isSpectator: true
      });
      
      console.log(`Spectator ${socket.id} joined room ${roomId}`);
    }
    
    // Send updated room info to all in the room
    io.to(roomId).emit('roomUpdate', getRoomData(room));
  });
  
  // Handle starting the game
  socket.on('startGame', (roomId) => {
    const room = gameRooms.get(roomId);
    
    if (!room) return;
    
    if (socket.id !== room.host) {
      socket.emit('error', 'Only the host can start the game');
      return;
    }
    
    if (room.players.length === 0) {
      socket.emit('error', 'Cannot start game without players');
      return;
    }
    
    // Update room status
    room.status = 'playing';
    room.activePlayerIndex = 0;
    
    // Notify all clients in the room
    io.to(roomId).emit('gameStarted', {
      roomId: roomId,
      firstPlayer: room.players[0].id
    });
    
    console.log(`Game started in room ${roomId}`);
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
    const { roomId, cupIndex, playerId } = data;
    const room = gameRooms.get(roomId);
    
    if (!room || room.status !== 'playing') return;
    
    // Update the cup state for the current active player
    const activePlayer = room.players[room.activePlayerIndex];
    const cups = room.gameState.cups[activePlayer.id];
    
    if (cups && cupIndex >= 0 && cupIndex < cups.length) {
      cups[cupIndex] = false;
      
      // Update score
      room.gameState.scores[activePlayer.id] = (room.gameState.scores[activePlayer.id] || 0) + 1;
      
      // Check if all cups are hit
      const allCupsHit = cups.every(cup => !cup);
      
      if (allCupsHit) {
        // This player has won
        io.to(roomId).emit('playerWon', {
          player: activePlayer,
          scores: room.gameState.scores
        });
        
        // End the game
        room.status = 'completed';
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
    
    // Move to next player's turn
    advanceToNextPlayer(room);
    
    // Notify all clients
    io.to(roomId).emit('turnChange', {
      activePlayer: room.players[room.activePlayerIndex],
      gameState: room.gameState
    });
  });
  
  // Handle closing a room
  socket.on('closeRoom', (roomId) => {
    const room = gameRooms.get(roomId);
    
    if (room && socket.id === room.host) {
      io.to(roomId).emit('roomClosed');
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
    
    // Check if the client was a host of any room
    for (const [roomId, room] of gameRooms.entries()) {
      if (room.host === socket.id) {
        // Notify all clients in the room
        io.to(roomId).emit('roomClosed', { reason: 'Host disconnected' });
        gameRooms.delete(roomId);
        console.log(`Room ${roomId} closed because host disconnected`);
      } 
      // Check if client was a player in any room
      else if (room.players.some(p => p.id === socket.id)) {
        // Mark player as disconnected
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex >= 0) {
          room.players[playerIndex].connected = false;
          
          // If it was the active player's turn, move to the next player
          if (room.activePlayerIndex === playerIndex && room.status === 'playing') {
            advanceToNextPlayer(room);
          }
          
          // Notify all clients in the room
          io.to(roomId).emit('playerDisconnected', {
            playerId: socket.id,
            activePlayer: room.players[room.activePlayerIndex]
          });
          
          // Update host about player count
          io.to(room.host).emit('playerCountUpdate', {
            roomId: roomId,
            count: room.players.filter(p => p.connected).length
          });
          
          console.log(`Player ${socket.id} disconnected from room ${roomId}`);
        }
      }
      // Check if client was a spectator
      else if (room.spectators.includes(socket.id)) {
        room.spectators = room.spectators.filter(id => id !== socket.id);
        console.log(`Spectator ${socket.id} disconnected from room ${roomId}`);
      }
    }
    
    // Update room list for all clients
    io.emit('roomList', Array.from(gameRooms.values())
      .filter(room => room.status === 'waiting')
      .map(r => getRoomData(r)));
  });
});

// Helper function to advance to the next player's turn
function advanceToNextPlayer(room) {
  const connectedPlayers = room.players.filter(p => p.connected);
  if (connectedPlayers.length === 0) return;
  
  let nextIndex = (room.activePlayerIndex + 1) % room.players.length;
  
  // Skip disconnected players
  while (!room.players[nextIndex].connected) {
    nextIndex = (nextIndex + 1) % room.players.length;
  }
  
  room.activePlayerIndex = nextIndex;
}

// Start the server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});