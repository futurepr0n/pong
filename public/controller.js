// Get room ID from URL parameters
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

if (!roomId) {
  alert('No room ID provided. Please use the QR code to join a game.');
  window.location.href = '/';
}

// DOM Elements
const nameForm = document.getElementById('nameForm');
const nameInput = document.getElementById('nameInput');
const nameSubmit = document.getElementById('nameSubmit');
const gameControls = document.getElementById('gameControls');
const waitingOverlay = document.getElementById('waitingOverlay');
const waitingMessage = document.getElementById('waitingMessage');
const throwButton = document.getElementById('throwButton');
const statusDisplay = document.getElementById('statusDisplay');
const roomCodeDisplay = document.getElementById('roomCode');
const playerNameDisplay = document.getElementById('playerName');
const roundDisplay = document.getElementById('roundDisplay');
const turnDisplay = document.getElementById('turnDisplay');
const cupDisplay = document.getElementById('cupDisplay');
const debugElement = document.getElementById('debugElement');

// Game state
let playerInfo = null;
let isMyTurn = false;
let isThrowing = false;
let cupState = Array(6).fill(true);
let motionPermissionGranted = false;

// Orientation tracking
let initialOrientation = { beta: 0, gamma: 0 };
let currentOrientation = { beta: 0, gamma: 0 };
let throwStartTime = 0;
let orientationHistory = [];
let lastOrientationTime = 0;
let velocityReadings = [];

// Connect to Socket.io server
const socket = io();

// Update debug display with orientation data
function updateDebug() {
  debugElement.textContent = `Current: β=${currentOrientation.beta.toFixed(1)}° γ=${currentOrientation.gamma.toFixed(1)}°`;
  if (isThrowing) {
    const betaDiff = currentOrientation.beta - initialOrientation.beta;
    const gammaDiff = currentOrientation.gamma - initialOrientation.gamma;
    debugElement.textContent += `\nDiff: β=${betaDiff.toFixed(1)}° γ=${gammaDiff.toFixed(1)}°`;
  }
}

// Setup cup display
function setupCupDisplay() {
  cupDisplay.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const cup = document.createElement('div');
    cup.className = 'cup' + (cupState[i] ? '' : ' hit');
    cup.dataset.index = i;
    cupDisplay.appendChild(cup);
  }
}

// Update cup display based on current state
function updateCupDisplay() {
  const cups = cupDisplay.querySelectorAll('.cup');
  cups.forEach((cup, index) => {
    if (cupState[index]) {
      cup.classList.remove('hit');
    } else {
      cup.classList.add('hit');
    }
  });
}

// Handle iOS permissions correctly
function setupMotionPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && 
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    
    // iOS 13+ requires permission
    statusDisplay.textContent = 'iOS device detected. Click to enable motion sensing.';
    
    // Create permission button (only once)
    const permissionButton = document.createElement('button');
    permissionButton.textContent = 'Enable Motion Control';
    permissionButton.style.fontSize = '20px';
    permissionButton.style.margin = '20px';
    permissionButton.style.padding = '10px';
    permissionButton.style.backgroundColor = '#4CAF50';
    permissionButton.style.color = 'white';
    permissionButton.style.border = 'none';
    permissionButton.style.borderRadius = '5px';
    
    permissionButton.onclick = async () => {
      try {
        statusDisplay.textContent = 'Requesting permission...';
        
        // Request device orientation permission
        const orientationPermission = await DeviceOrientationEvent.requestPermission();
        
        if (orientationPermission === 'granted') {
          // Permission granted, remove button and initialize
          permissionButton.remove();
          motionPermissionGranted = true;
          statusDisplay.textContent = 'Motion permission granted. Waiting for your turn.';
          
          // Now start listening for orientation events
          initOrientationTracking();
        } else {
          statusDisplay.textContent = 'Permission denied. Motion tracking unavailable.';
        }
      } catch (e) {
        console.error('Error requesting permissions:', e);
        statusDisplay.textContent = 'Permission request failed: ' + e.message;
      }
    };
    
    // Add button to page
    gameControls.insertBefore(permissionButton, throwButton);
    
  } else {
    // Non-iOS or older iOS that doesn't need permission
    motionPermissionGranted = true;
    initOrientationTracking();
  }
}

// Initialize orientation tracking
function initOrientationTracking() {
  window.addEventListener('deviceorientation', (event) => {
    // Update current orientation values
    if (event.beta !== null) currentOrientation.beta = event.beta;
    if (event.gamma !== null) currentOrientation.gamma = event.gamma;
    
    updateDebug();
    
    // If we're tracking a throw, record the data points
    if (isThrowing) {
      const timestamp = Date.now();
      
      // Record orientation points every 30ms
      if (timestamp - lastOrientationTime > 30) {
        // Save this point to our history
        orientationHistory.push({
          beta: currentOrientation.beta,
          gamma: currentOrientation.gamma,
          timestamp: timestamp
        });
        
        // Calculate instantaneous velocity if we have at least 2 points
        if (orientationHistory.length >= 2) {
          const current = orientationHistory[orientationHistory.length - 1];
          const previous = orientationHistory[orientationHistory.length - 2];
          const timeDiff = (current.timestamp - previous.timestamp) / 1000; // in seconds
          
          if (timeDiff > 0) {
            // Calculate angular velocity in degrees per second
            const betaVelocity = (current.beta - previous.beta) / timeDiff;
            const gammaVelocity = (current.gamma - previous.gamma) / timeDiff;
            
            // Store velocity reading
            velocityReadings.push({
              beta: betaVelocity,
              gamma: gammaVelocity,
              timestamp: current.timestamp
            });
          }
        }
        
        lastOrientationTime = timestamp;
      }
    }
  });
}

// Start throw
throwButton.addEventListener('touchstart', (e) => {
  e.preventDefault();
  
  if (!isMyTurn) {
    statusDisplay.textContent = 'Wait for your turn to throw.';
    return;
  }
  
  if (!motionPermissionGranted) {
    statusDisplay.textContent = 'Motion permission required. Enable motion control first.';
    return;
  }
  
  isThrowing = true;
  throwStartTime = Date.now();
  initialOrientation.beta = currentOrientation.beta;
  initialOrientation.gamma = currentOrientation.gamma;
  
  // Reset history and velocity readings for this throw
  orientationHistory = [{
    beta: initialOrientation.beta,
    gamma: initialOrientation.gamma,
    timestamp: throwStartTime
  }];
  velocityReadings = [];
  lastOrientationTime = throwStartTime;
  
  statusDisplay.textContent = 'Hold and swing your phone to throw...';
});

// End throw and calculate trajectory
throwButton.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (!isThrowing) return;
  isThrowing = false;
  
  const throwEndTime = Date.now();
  const throwDuration = (throwEndTime - throwStartTime) / 1000; // in seconds
  
  // Add final position to history
  orientationHistory.push({
    beta: currentOrientation.beta,
    gamma: currentOrientation.gamma,
    timestamp: throwEndTime
  });
  
  // Simple check for device orientation change to see if we're capturing anything
  const betaDiff = currentOrientation.beta - initialOrientation.beta;
  const gammaDiff = currentOrientation.gamma - initialOrientation.gamma;
  const totalChange = Math.abs(betaDiff) + Math.abs(gammaDiff);
  
  console.log('Beta difference:', betaDiff);
  console.log('Gamma difference:', gammaDiff);
  
  // Direct conversion of orientation change to velocity
  // X velocity is based on gamma change (left/right tilt)
  const xVelocity = gammaDiff * -0.3; // Invert and scale
  
  // Y velocity is based on beta change (forward/back tilt)
  let yVelocity;
  if (betaDiff < 0) {
    // Phone tilted more upward = higher throw
    yVelocity = 5 + Math.min(Math.abs(betaDiff) * 0.2, 5);
  } else {
    // Phone tilted more downward = lower throw
    yVelocity = Math.max(5 - betaDiff * 0.15, 2);
  }
  
  // Z velocity scales with total motion
  const zVelocity = 6 + Math.min(totalChange * 0.1, 4);
  
  // Final velocity calculation
  const velocity = {
    x: xVelocity,
    y: yVelocity,
    z: zVelocity
  };
  
  // Display throw info
  statusDisplay.textContent = `Throw sent: ${totalChange.toFixed(1)}° motion`;
  
  // Send throw data to server with room ID
  socket.emit('throw', {
    roomId: roomId,
    velocity: velocity
  });
  
  // Disable throw button until server confirms turn change
  throwButton.disabled = true;
  isMyTurn = false;
});

// Handle name submission
nameSubmit.addEventListener('click', () => {
  const playerName = nameInput.value.trim() || 'Player';
  
  if (playerName) {
    // Join the room as a controller
    socket.emit('joinRoom', {
      roomId: roomId,
      name: playerName,
      isController: true
    });
  }
});

// Socket.io event handlers
socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('joinResponse', (data) => {
  if (data.success) {
    // Hide the name form and show game controls
    nameForm.style.display = 'none';
    gameControls.style.display = 'flex';
    
    // Update displays
    roomCodeDisplay.textContent = data.roomId;
    playerInfo = data.playerInfo;
    playerNameDisplay.textContent = playerInfo.name;
    
    // Setup the game
    setupCupDisplay();
    setupMotionPermission();
  } else {
    alert(`Failed to join game: ${data.message}`);
    window.location.href = '/';
  }
});

socket.on('gameStarted', (data) => {
  // Hide the waiting overlay
  waitingOverlay.style.display = 'none';
  
  // Check if it's this player's turn
  if (data.firstPlayer === socket.id) {
    isMyTurn = true;
    throwButton.disabled = false;
    statusDisplay.textContent = 'Your turn! Hold to throw.';
    turnDisplay.textContent = 'Your Turn';
  } else {
    isMyTurn = false;
    throwButton.disabled = true;
    statusDisplay.textContent = 'Waiting for your turn...';
    turnDisplay.textContent = 'Other Player';
  }
});

socket.on('turnChange', (data) => {
  // Update turn info
  if (data.activePlayer.id === socket.id) {
    isMyTurn = true;
    throwButton.disabled = false;
    statusDisplay.textContent = 'Your turn! Hold to throw.';
    turnDisplay.textContent = 'Your Turn';
  } else {
    isMyTurn = false;
    throwButton.disabled = true;
    statusDisplay.textContent = `Waiting for ${data.activePlayer.name}'s turn...`;
    turnDisplay.textContent = data.activePlayer.name;
  }
  
  // Update cup state if available for this player
  if (data.gameState && data.gameState.cups && data.gameState.cups[socket.id]) {
    cupState = data.gameState.cups[socket.id];
    updateCupDisplay();
  }
  
  // Update round if provided
  if (data.gameState && data.gameState.round) {
    roundDisplay.textContent = data.gameState.round;
  }
});

socket.on('playerWon', (data) => {
  const winner = data.player;
  const isWinner = winner.id === socket.id;
  
  if (isWinner) {
    waitingOverlay.style.display = 'flex';
    waitingMessage.textContent = '🏆 You Won! 🏆';
  } else {
    waitingOverlay.style.display = 'flex';
    waitingMessage.textContent = `${winner.name} Won!`;
  }
  
  // Disable throwing
  isMyTurn = false;
  throwButton.disabled = true;
});

socket.on('roomClosed', () => {
  alert('The game room has been closed.');
  window.location.href = '/';
});

socket.on('disconnect', () => {
  waitingOverlay.style.display = 'flex';
  waitingMessage.textContent = 'Disconnected from server. Trying to reconnect...';
});