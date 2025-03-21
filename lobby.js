// Connect to Socket.io server
const socket = io();

// DOM Elements
const createRoomBtn = document.getElementById('createRoomBtn');
const qrModal = document.getElementById('qrModal');
const closeModal = document.getElementById('closeModal');
const roomIdSpan = document.getElementById('roomId');
const playerCountSpan = document.getElementById('playerCount');
const startGameBtn = document.getElementById('startGameBtn');
const roomsContainer = document.getElementById('roomsContainer');

// Variables
let currentRoomId = null;
let isHost = false;

// Create Room Button Click
createRoomBtn.addEventListener('click', () => {
  socket.emit('createRoom');
});

// Close Modal Button Click
closeModal.addEventListener('click', () => {
  if (isHost && currentRoomId) {
    if (confirm("Are you sure you want to close this room? All connections will be lost.")) {
      socket.emit('closeRoom', currentRoomId);
      hideModal();
    }
  } else {
    hideModal();
  }
});

// Start Game Button Click
startGameBtn.addEventListener('click', () => {
  if (isHost && currentRoomId) {
    socket.emit('startGame', currentRoomId);
  }
});

// Handle Room Creation Response
socket.on('roomCreated', (data) => {
  currentRoomId = data.roomId;
  isHost = true;
  showRoomQR(data.roomId, data.joinUrl);
  updatePlayerCount(data.players.length);
  startGameBtn.disabled = data.players.length === 0;
});

// Handle Room List Update
socket.on('roomList', (rooms) => {
  updateRoomList(rooms);
});

// Handle Player Count Update
socket.on('playerCountUpdate', (data) => {
  if (data.roomId === currentRoomId) {
    updatePlayerCount(data.count);
    startGameBtn.disabled = data.count === 0;
  }
});

// Handle Game Start
socket.on('gameStarted', (data) => {
  if (data.roomId === currentRoomId && isHost) {
    window.location.href = `/game.html?room=${currentRoomId}&host=true`;
  }
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

// Function to show QR code modal
function showRoomQR(roomId, joinUrl) {
  roomIdSpan.textContent = roomId;
  
  // Generate QR code
  const qrContainer = document.getElementById('qrcode');
  qrContainer.innerHTML = '';
  
  new QRCode(qrContainer, {
    text: joinUrl,
    width: 200,
    height: 200,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
  
  qrModal.style.display = 'flex';
}

// Function to hide the modal
function hideModal() {
  qrModal.style.display = 'none';
  currentRoomId = null;
  isHost = false;
}

// Function to update player count
function updatePlayerCount(count) {
  playerCountSpan.textContent = count;
}

// Initial request for room list
socket.emit('getRoomList');