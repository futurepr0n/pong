// Connect to Socket.io server
const socket = io();

// DOM Elements
const createRoomBtn = document.getElementById('createRoomBtn');
const roomsContainer = document.getElementById('roomsContainer');
const loadingElement = document.getElementById('loading');

// Create Room Button Click
createRoomBtn.addEventListener('click', () => {
  // Show loading indicator
  createRoomBtn.disabled = true;
  loadingElement.style.display = 'block';
  
  // Generate a unique host token
  const hostToken = Math.random().toString(36).substring(2, 15) + 
                    Math.random().toString(36).substring(2, 15);
  
  // Emit create room event
  socket.emit('createRoom', { hostToken });
});

// Handle Room Creation Response
socket.on('roomCreated', (data) => {
  // Redirect to the game page with the room ID and host token
  window.location.href = `/game.html?room=${data.roomId}&host=true&token=${data.hostToken}`;
});

// Enhanced error handling for room joining
socket.on('joinResponse', (data) => {
  if (!data.success) {
    // More informative error handling
    console.error('Room join failed:', data.message);
    alert(data.message || 'Failed to join the game room. Please try again.');
    window.location.href = '/';
  }
});

// Handle room list updates
socket.on('roomList', (rooms) => {
  roomsContainer.innerHTML = rooms.length > 0 
    ? rooms.map(room => `
        <div class="room-item">
          <span>Room: ${room.id} (${room.players.length}/10 players)</span>
          <button class="join-btn" data-room="${room.id}">Join</button>
        </div>
      `).join('')
    : '<div class="room-item"><span>No active rooms found.</span></div>';
  
  // Add event listeners to join buttons
  document.querySelectorAll('.join-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const roomId = btn.getAttribute('data-room');
      window.location.href = `/game.html?room=${roomId}&spectator=true`;
    });
  });
});

// Add additional error logging
socket.on('error', (errorMessage) => {
  console.error('Socket error:', errorMessage);
  alert(`Error: ${errorMessage}`);
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
});

// Handle connection issues more robustly
socket.on('disconnect', () => {
  console.warn('Disconnected from server');
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
  alert('Connection lost. Please check your internet and try again.');
});

socket.on('connect', () => {
  console.log('Connected to server');
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
  
  // Request initial room list
  socket.emit('getRoomList');
});

// Initial request for room list
socket.emit('getRoomList');