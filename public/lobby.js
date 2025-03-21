// Connect to Socket.io server
const socket = io();

// DOM Elements
const createRoomBtn = document.getElementById('createRoomBtn');
const roomsContainer = document.getElementById('roomsContainer');
const loadingElement = document.getElementById('loading');

// Room Creation State
let isCreatingRoom = false;

// Create Room Button Click
createRoomBtn.addEventListener('click', () => {
  // Prevent multiple clicks
  if (isCreatingRoom) return;
  
  // Show loading indicator
  isCreatingRoom = true;
  createRoomBtn.disabled = true;
  loadingElement.style.display = 'block';
  
  // Generate a unique host token
  const hostToken = Math.random().toString(36).substring(2, 15) + 
                   Math.random().toString(36).substring(2, 15);
  
  // Emit create room event
  socket.emit('createRoom', { hostToken });
  
  // Add timeout to prevent UI from getting stuck
  setTimeout(() => {
    if (isCreatingRoom) {
      isCreatingRoom = false;
      createRoomBtn.disabled = false;
      loadingElement.style.display = 'none';
      alert('Room creation timed out. Please try again.');
    }
  }, 5000);
});

// Handle Room Creation Response
socket.on('roomCreated', (data) => {
  isCreatingRoom = false;
  
  console.log('Room created:', data);
  
  // Redirect to the game page with the room ID and host token
  window.location.href = `/game.html?room=${data.roomId}&host=true&token=${data.hostToken}`;
});

// Enhanced error handling for room joining
socket.on('joinResponse', (data) => {
  if (!data.success) {
    // More informative error handling
    console.error('Room join failed:', data.message);
    alert(data.message || 'Failed to join the game room. Please try again.');
    
    // Return to lobby
    if (window.location.pathname !== '/') {
      window.location.href = '/';
    }
  }
});

// Handle room list updates
socket.on('roomList', (rooms) => {
  if (!rooms || !Array.isArray(rooms)) {
    console.error('Invalid room list data received');
    return;
  }
  
  // Update the UI with rooms
  if (rooms.length > 0) {
    let roomsHTML = '';
    
    rooms.forEach(room => {
      roomsHTML += `
        <div class="room-item">
          <span>Room: ${room.id} (${room.players}/10 players)</span>
          <button class="join-btn" data-room="${room.id}">Join</button>
        </div>
      `;
    });
    
    roomsContainer.innerHTML = roomsHTML;
    
    // Add event listeners to join buttons
    document.querySelectorAll('.join-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const roomId = btn.getAttribute('data-room');
        window.location.href = `/game.html?room=${roomId}&spectator=true`;
      });
    });
  } else {
    roomsContainer.innerHTML = '<div class="room-item"><span>No active rooms found.</span></div>';
  }
});

// Error handling
socket.on('error', (errorMessage) => {
  console.error('Socket error:', errorMessage);
  alert(`Error: ${errorMessage}`);
  
  // Reset UI
  isCreatingRoom = false;
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
});

// Connection management
socket.on('disconnect', () => {
  console.warn('Disconnected from server');
  
  // Reset UI
  isCreatingRoom = false;
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
  
  // Show alert but only if still on lobby page
  if (document.readyState === 'complete' && window.location.pathname === '/') {
    alert('Connection lost. Please check your internet and try again.');
  }
});

socket.on('connect', () => {
  console.log('Connected to server');
  
  // Reset UI
  isCreatingRoom = false;
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
  
  // Request initial room list
  socket.emit('getRoomList');
});

// Request room list when page loads
window.addEventListener('load', () => {
  socket.emit('getRoomList');
});