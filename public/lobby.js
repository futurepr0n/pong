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
  
  // Generate a unique host token that will persist across page navigation
  const hostToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  
  // Store the host token in localStorage
  localStorage.setItem('hostToken', hostToken);
  
  socket.emit('createRoom', { hostToken });
});

// Handle Room Creation Response
socket.on('roomCreated', (data) => {
  // Store the host token for potential reconnection
  if (data.hostToken) {
    localStorage.setItem(`hostToken_${data.roomId}`, data.hostToken);
  }
  
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
});

// Initial request for room list
socket.emit('getRoomList');