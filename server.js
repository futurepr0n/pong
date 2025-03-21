const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const Database = require('better-sqlite3');

// Open the database
const db = new Database('game_rooms.db', { verbose: console.log });

// Create tables with foreign key support
db.prepare(`
  PRAGMA foreign_keys = ON;
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS rooms (
    room_id TEXT PRIMARY KEY,
    host_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'waiting',
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS room_players (
    room_id TEXT,
    player_id TEXT,
    name TEXT,
    is_host BOOLEAN DEFAULT 0,
    is_connected BOOLEAN DEFAULT 1,
    PRIMARY KEY (room_id, player_id),
    FOREIGN KEY (room_id) REFERENCES rooms (room_id) ON DELETE CASCADE
  )
`).run();

// Serve static files from the public directory
app.use(express.static('public'));

// Base URL for QR codes - use environment variable or default to localhost
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

// Helper function to generate room ID (without using uuid)
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Create a new room
  socket.on('createRoom', (data) => {
    const roomId = generateRoomId();
    const hostToken = (data && data.hostToken) || 
      Math.random().toString(36).substring(2, 15) + 
      Math.random().toString(36).substring(2, 15);
    
    const transaction = db.transaction(() => {
      // Insert room into database
      const insertRoom = db.prepare(`
        INSERT INTO rooms (room_id, host_token, status) 
        VALUES (?, ?, 'waiting')
      `);
      insertRoom.run(roomId, hostToken);
      
      // Insert host as a player
      const insertPlayer = db.prepare(`
        INSERT INTO room_players (room_id, player_id, name, is_host) 
        VALUES (?, ?, ?, 1)
      `);
      insertPlayer.run(roomId, socket.id, 'Host');
      
      return roomId;
    });
    
    try {
      const createdRoomId = transaction();
      
      socket.join(createdRoomId);
      socket.currentRoom = createdRoomId;
      
      // Send room creation response
      socket.emit('roomCreated', {
        roomId: createdRoomId, 
        joinUrl: `${BASE_URL}/controller.html?room=${createdRoomId}`,
        hostToken: hostToken,
        players: []
      });
      
      console.log(`Room created: ${createdRoomId} by ${socket.id}`);
    } catch (error) {
      console.error('Room creation error:', error);
      socket.emit('error', 'Failed to create room');
    }
  });
  
  // Get Room List
  socket.on('getRoomList', () => {
    try {
      // Get active rooms with player count
      const getRooms = db.prepare(`
        SELECT r.room_id, r.status, 
               COUNT(rp.player_id) as player_count
        FROM rooms r
        LEFT JOIN room_players rp ON r.room_id = rp.room_id AND rp.is_connected = 1
        WHERE r.status = 'waiting'
        GROUP BY r.room_id
      `);
      
      const rooms = getRooms.all().map(room => ({
        id: room.room_id,
        status: room.status,
        players: Array(room.player_count).fill({}) // Placeholder for player data
      }));
      
      socket.emit('roomList', rooms);
    } catch (error) {
      console.error('Error getting room list:', error);
      socket.emit('error', 'Failed to retrieve room list');
    }
  });
  
  // Join an existing room
  socket.on('joinRoom', (data) => {
    const { roomId, name, isController, isHost, hostToken } = data;
    
    try {
      // Find the room, optionally by host token
      let room;
      if (hostToken) {
        room = db.prepare(`
          SELECT * FROM rooms 
          WHERE room_id = ? OR host_token = ?
        `).get(roomId, hostToken);
      } else {
        room = db.prepare(`
          SELECT * FROM rooms 
          WHERE room_id = ?
        `).get(roomId);
      }
      
      // Room not found
      if (!room) {
        console.error(`Room not found: ${roomId}, Host Token: ${hostToken}`);
        socket.emit('joinResponse', { 
          success: false, 
          message: 'Room not found. It may have expired or been closed.',
          roomId: roomId 
        });
        return;
      }
      
      // Transaction for adding/updating player
      const transaction = db.transaction(() => {
        if (isController) {
          // Check if player already exists
          const existingPlayer = db.prepare(`
            SELECT * FROM room_players 
            WHERE room_id = ? AND player_id = ?
          `).get(room.room_id, socket.id);
          
          if (existingPlayer) {
            // Update existing player
            db.prepare(`
              UPDATE room_players 
              SET name = ?, is_connected = 1 
              WHERE room_id = ? AND player_id = ?
            `).run(
              name || existingPlayer.name, 
              room.room_id, 
              socket.id
            );
          } else {
            // Insert new player
            db.prepare(`
              INSERT INTO room_players (room_id, player_id, name, is_host) 
              VALUES (?, ?, ?, 0)
            `).run(
              room.room_id, 
              socket.id, 
              name || `Player ${Date.now()}`
            );
          }
          
          // Get player details
          const playerInfo = db.prepare(`
            SELECT * FROM room_players 
            WHERE room_id = ? AND player_id = ?
          `).get(room.room_id, socket.id);
          
          return { 
            success: true, 
            roomId: room.room_id,
            playerInfo: playerInfo,
            isController: true
          };
        } else if (isHost) {
          // Update host information
          db.prepare(`
            UPDATE rooms 
            SET host_token = ? 
            WHERE room_id = ?
          `).run(hostToken || room.host_token, room.room_id);
          
          return {
            success: true,
            roomId: room.room_id,
            isHost: true,
            joinUrl: `${BASE_URL}/controller.html?room=${room.room_id}`
          };
        }
      });
      
      // Execute transaction
      const result = transaction();
      
      if (result) {
        // Join the socket room
        socket.join(room.room_id);
        socket.currentRoom = room.room_id;
        
        // Update last active timestamp
        db.prepare(`
          UPDATE rooms 
          SET last_active = CURRENT_TIMESTAMP 
          WHERE room_id = ?
        `).run(room.room_id);
        
        // Emit join response
        socket.emit('joinResponse', result);
        
        // Broadcast room update
        const players = db.prepare(`
          SELECT * FROM room_players 
          WHERE room_id = ? AND is_connected = 1
        `).all(room.room_id);
        
        io.to(room.room_id).emit('roomUpdate', {
          roomId: room.room_id,
          players: players,
          status: room.status
        });
      }
      
    } catch (error) {
      console.error('Room join error:', error);
      socket.emit('joinResponse', { 
        success: false, 
        message: 'Error joining room',
        roomId: roomId 
      });
    }
  });
  
  // Periodic cleanup of old rooms
  function cleanupRooms() {
    const transaction = db.transaction(() => {
      // Remove rooms older than 1 hour and not in active status
      // This will cascade delete room_players due to ON DELETE CASCADE
      const cleanupStmt = db.prepare(`
        DELETE FROM rooms 
        WHERE status = 'waiting' AND 
        last_active < datetime('now', '-1 hour')
      `);
      cleanupStmt.run();
    });
    
    try {
      transaction();
    } catch (error) {
      console.error('Room cleanup error:', error);
    }
  }
  
  // Run cleanup every 15 minutes
  setInterval(cleanupRooms, 15 * 60 * 1000);
  
  // Handle disconnection
  socket.on('disconnect', () => {
    if (socket.currentRoom) {
      const transaction = db.transaction(() => {
        // Mark player as disconnected
        db.prepare(`
          UPDATE room_players 
          SET is_connected = 0 
          WHERE room_id = ? AND player_id = ?
        `).run(socket.currentRoom, socket.id);
        
        // Check if room is now empty
        const remainingPlayers = db.prepare(`
          SELECT COUNT(*) as count 
          FROM room_players 
          WHERE room_id = ? AND is_connected = 1
        `).get(socket.currentRoom).count;
        
        // If no players are connected, remove the room
        if (remainingPlayers === 0) {
          // This will automatically remove associated players due to CASCADE
          db.prepare(`
            DELETE FROM rooms 
            WHERE room_id = ?
          `).run(socket.currentRoom);
        }
      });
      
      try {
        transaction();
      } catch (error) {
        console.error('Disconnection handling error:', error);
      }
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open a browser and navigate to http://localhost:${PORT}`);
});