// Connect to Socket.io server with reconnection options
const socket = io({
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 3000,
  timeout: 10000
});

// Debug mode
const DEBUG = true;
function log(message, obj = null) {
  if (DEBUG) {
    if (obj) {
      console.log(`[LOBBY] ${message}`, obj);
    } else {
      console.log(`[LOBBY] ${message}`);
    }
  }
}

// DOM Elements
const createRoomBtn = document.getElementById('createRoomBtn');
const roomsContainer = document.getElementById('roomsContainer');
const loadingElement = document.getElementById('loading');

// Room Creation State
let isCreatingRoom = false;
let creationTimeout = null;

// Connection status indicator
const connectionStatus = document.createElement('div');
connectionStatus.style.position = 'absolute';
connectionStatus.style.top = '10px';
connectionStatus.style.right = '10px';
connectionStatus.style.width = '10px';
connectionStatus.style.height = '10px';
connectionStatus.style.borderRadius = '50%';
connectionStatus.style.backgroundColor = '#ccc';
document.body.appendChild(connectionStatus);

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
  
  log('Creating room with token:', hostToken);
  
  // Emit create room event
  socket.emit('createRoom', { hostToken });
  
  // Add timeout to prevent UI from getting stuck
  creationTimeout = setTimeout(() => {
    if (isCreatingRoom) {
      isCreatingRoom = false;
      createRoomBtn.disabled = false;
      loadingElement.style.display = 'none';
      alert('Room creation timed out. Please try again.');
    }
  }, 10000);
});

// Handle Room Creation Response
socket.on('roomCreated', (data) => {
  log('Room created:', data);
  
  // Clear timeout
  if (creationTimeout) {
    clearTimeout(creationTimeout);
    creationTimeout = null;
  }
  
  isCreatingRoom = false;
  
  // Before redirecting, store the token in localStorage to help with reconnection
  try {
    localStorage.setItem(`host_token_${data.roomId}`, data.hostToken);
  } catch (e) {
    // Ignore localStorage errors
    console.error('Failed to store host token:', e);
  }
  
  // Redirect to the game page with the room ID and host token
  window.location.href = `/game.html?room=${data.roomId}&host=true&token=${data.hostToken}`;
});

// Handle room join failure
socket.on('joinResponse', (data) => {
  if (!data.success) {
    // More informative error handling
    log('Room join failed:', data.message);
    alert(data.message || 'Failed to join the game room. Please try again.');
    
    // Reset UI
    isCreatingRoom = false;
    createRoomBtn.disabled = false;
    loadingElement.style.display = 'none';
  }
});

// Handle room list updates
socket.on('roomList', (rooms) => {
  if (!rooms || !Array.isArray(rooms)) {
    log('Invalid room list data received');
    return;
  }
  
  log('Received room list:', rooms);
  
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
  log('Socket error:', errorMessage);
  alert(`Error: ${errorMessage}`);
  
  // Reset UI
  isCreatingRoom = false;
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
});

// Connection management
socket.on('connect', () => {
  log('Connected to server');
  connectionStatus.style.backgroundColor = '#4CAF50'; // Green when connected
  
  // Reset UI
  isCreatingRoom = false;
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
  
  // Request initial room list
  socket.emit('getRoomList');
});

socket.on('disconnect', () => {
  log('Disconnected from server');
  connectionStatus.style.backgroundColor = '#f44336'; // Red when disconnected
  
  // Reset UI if needed
  if (isCreatingRoom) {
    isCreatingRoom = false;
    createRoomBtn.disabled = false;
    loadingElement.style.display = 'none';
    alert('Connection lost during room creation. Please try again when reconnected.');
  }
});

socket.on('connect_error', (error) => {
  log('Connection error:', error);
  connectionStatus.style.backgroundColor = '#ff9800'; // Orange on connection error
});

socket.on('reconnect', (attemptNumber) => {
  log(`Reconnected after ${attemptNumber} attempts`);
  connectionStatus.style.backgroundColor = '#4CAF50'; // Green when reconnected
  
  // Request room list after reconnect
  socket.emit('getRoomList');
});

// Request room list when page loads
window.addEventListener('load', () => {
  log('Page loaded, requesting room list');
  socket.emit('getRoomList');
});