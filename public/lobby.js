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
  
  socket.emit('createRoom');
});

// Handle Room Creation Response
socket.on('roomCreated', (data) => {
  // Redirect to the game page with the room ID
  window.location.href = `/game.html?room=${data.roomId}&host=true`;
});

// Handle Room List Update
socket.on('roomList', (rooms) => {
  updateRoomList(rooms);
});

// Function to update the list of available rooms
function updateRoomList(rooms) {
  roomsContainer.innerHTML = '';
  
  if (rooms.length === 0) {
    roomsContainer.innerHTML = '<div class="room-item"><span>No active rooms found.</span></div>';
    return;
  }
  
  rooms.forEach(room => {
    const roomItem = document.createElement('div');
    roomItem.className = 'room-item';
    roomItem.innerHTML = `
      <span>Room: ${room.id} (${room.players.length}/10 players)</span>
      <button class="join-btn" data-room="${room.id}">Join</button>
    `;
    roomsContainer.appendChild(roomItem);
  });
  
  // Add event listeners to join buttons
  document.querySelectorAll('.join-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const roomId = btn.getAttribute('data-room');
      window.location.href = `/game.html?room=${roomId}&spectator=true`;
    });
  });
}

// Handle connection issues
socket.on('disconnect', () => {
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
  alert('Disconnected from server. Please refresh the page.');
});

socket.on('connect', () => {
  console.log('Connected to server');
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
});

// Handle errors
socket.on('error', (errorMessage) => {
  alert(`Error: ${errorMessage}`);
  createRoomBtn.disabled = false;
  loadingElement.style.display = 'none';
});

// Initial request for room list
socket.emit('getRoomList');