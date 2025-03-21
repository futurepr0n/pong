// Get room ID and host status from URL parameters
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const isHost = urlParams.get('host') === 'true';
const isSpectator = urlParams.get('spectator') === 'true';

if (!roomId) {
  alert('No room ID provided.');
  window.location.href = '/';
}

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, -5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Add some basic lighting
const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7);
directionalLight.castShadow = true;
scene.add(directionalLight);

// Physics setup
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0); // Earth gravity
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 10; // More accurate physics

// Materials
const tableMaterial = new CANNON.Material('tableMaterial');
tableMaterial.friction = 0.3;
tableMaterial.restitution = 0.5; // Bouncy but not too much

const ballMaterial = new CANNON.Material('ballMaterial');
ballMaterial.friction = 0.1;
ballMaterial.restitution = 0.8; // Ping pong balls are bouncy

const cupMaterial = new CANNON.Material('cupMaterial');
cupMaterial.friction = 0.7;
cupMaterial.restitution = 0.3;

const backboardMaterial = new CANNON.Material('backboardMaterial');
backboardMaterial.friction = 0.1;
backboardMaterial.restitution = 0.9; // Very bouncy backboard

// Create contact materials
const ballTableContact = new CANNON.ContactMaterial(
    ballMaterial, tableMaterial, { friction: 0.1, restitution: 0.6 }
);
world.addContactMaterial(ballTableContact);

const ballCupContact = new CANNON.ContactMaterial(
    ballMaterial, cupMaterial, { friction: 0.1, restitution: 0.2 }
);
world.addContactMaterial(ballCupContact);

const ballBackboardContact = new CANNON.ContactMaterial(
    ballMaterial, backboardMaterial, { friction: 0.05, restitution: 0.8 }
);
world.addContactMaterial(ballBackboardContact);

// Table
const tableGeometry = new THREE.BoxGeometry(4, 0.2, 8);
const tableMeshMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
const tableMesh = new THREE.Mesh(tableGeometry, tableMeshMaterial);
tableMesh.position.set(0, -0.1, 0); // Slightly below y=0 to have thickness
tableMesh.receiveShadow = true;
scene.add(tableMesh);

const tableBody = new CANNON.Body({ 
    mass: 0, // Static body
    material: tableMaterial,
    shape: new CANNON.Box(new CANNON.Vec3(2, 0.1, 4))
});
tableBody.position.set(0, -0.1, 0);
world.addBody(tableBody);

// Backboard (at the far end of the table)
const backboardGeometry = new THREE.BoxGeometry(4, 2, 0.2);
const backboardMeshMaterial = new THREE.MeshStandardMaterial({ color: 0x964B00 });
const backboardMesh = new THREE.Mesh(backboardGeometry, backboardMeshMaterial);
backboardMesh.position.set(0, 1, 3.9); // Position at the far end
backboardMesh.castShadow = true;
backboardMesh.receiveShadow = true;
scene.add(backboardMesh);

const backboardBody = new CANNON.Body({
    mass: 0, // Static body
    material: backboardMaterial,
    shape: new CANNON.Box(new CANNON.Vec3(2, 1, 0.1))
});
backboardBody.position.copy(backboardMesh.position);
world.addBody(backboardBody);

// Cup positions in triangle formation
const cupPositions = [
    [0, 0, 2.5],             // Center front
    [0.45, 0, 2.5],          // Right front
    [-0.45, 0, 2.5],         // Left front
    [0.225, 0, 2.1],         // Right middle
    [-0.225, 0, 2.1],        // Left middle
    [0, 0, 1.7]              // Back
];

// Cup setup function
function createCups() {
  const cups = [];
  const cupRadius = 0.2;
  const cupHeight = 0.5;

  cupPositions.forEach((pos, index) => {
    // Visual mesh
    const cupGeometry = new THREE.CylinderGeometry(cupRadius, cupRadius, cupHeight, 32);
    const cupMeshMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const cupMesh = new THREE.Mesh(cupGeometry, cupMeshMaterial);
    cupMesh.position.set(pos[0], cupHeight / 2, pos[2]);
    cupMesh.castShadow = true;
    cupMesh.receiveShadow = true;
    scene.add(cupMesh);

    // Physics body
    const cupBody = new CANNON.Body({
      mass: 0, // Static body
      material: cupMaterial
    });
    
    // Use cylinder shape for better collision
    cupBody.addShape(new CANNON.Cylinder(cupRadius, cupRadius, cupHeight, 16));
    cupBody.position.set(pos[0], cupHeight / 2, pos[2]);
    world.addBody(cupBody);

    cups.push({ 
      mesh: cupMesh, 
      body: cupBody, 
      position: pos,
      active: true,  // Flag to track if cup is still in play
      index: index
    });
  });
  
  return cups;
}

// Ball
const ballRadius = 0.05;
const ballGeometry = new THREE.SphereGeometry(ballRadius, 32, 32);
const ballMeshMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
const ballMesh = new THREE.Mesh(ballGeometry, ballMeshMaterial);
ballMesh.castShadow = true;
scene.add(ballMesh);

const ballBody = new CANNON.Body({
    mass: 0.1, // Very light (like a ping pong ball)
    material: ballMaterial,
    shape: new CANNON.Sphere(ballRadius),
    linearDamping: 0.2, // Air resistance
    angularDamping: 0.2
});
ballBody.position.set(0, 1, -3); // Starting position
world.addBody(ballBody);

// Socket.io connection
const socket = io();

// Game state variables
let gameStarted = false;
let ballInFlight = false;
let lastThrowTime = 0;
const resetDelay = 5000; // 5 seconds
let activePlayer = null;
let players = [];
let playerCupStates = {}; // Map of player ID to cup states
let currentCups = []; // Current set of cups in the scene
let gameState = {
  round: 1
};

// Create UI elements
// Game info panel
const gameInfo = document.createElement('div');
gameInfo.style.position = 'absolute';
gameInfo.style.top = '20px';
gameInfo.style.left = '20px';
gameInfo.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
gameInfo.style.color = 'white';
gameInfo.style.padding = '15px';
gameInfo.style.borderRadius = '5px';
gameInfo.style.fontFamily = 'Arial, sans-serif';
gameInfo.style.zIndex = '100';
document.body.appendChild(gameInfo);

// Player list panel
const playerList = document.createElement('div');
playerList.style.position = 'absolute';
playerList.style.top = '20px';
playerList.style.right = '20px';
playerList.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
playerList.style.color = 'white';
playerList.style.padding = '15px';
playerList.style.borderRadius = '5px';
playerList.style.fontFamily = 'Arial, sans-serif';
playerList.style.zIndex = '100';
document.body.appendChild(playerList);

// Start button (only for host)
const startButton = document.createElement('button');
startButton.textContent = 'Start Game';
startButton.style.position = 'absolute';
startButton.style.bottom = '20px';
startButton.style.left = '50%';
startButton.style.transform = 'translateX(-50%)';
startButton.style.padding = '15px 30px';
startButton.style.fontSize = '18px';
startButton.style.backgroundColor = '#4CAF50';
startButton.style.color = 'white';
startButton.style.border = 'none';
startButton.style.borderRadius = '5px';
startButton.style.cursor = 'pointer';
startButton.style.display = isHost ? 'block' : 'none';
startButton.style.zIndex = '100';
document.body.appendChild(startButton);

// QR code display for host
const qrContainer = document.createElement('div');
qrContainer.style.position = 'absolute';
qrContainer.style.top = '50%';
qrContainer.style.left = '50%';
qrContainer.style.transform = 'translate(-50%, -50%)';
qrContainer.style.backgroundColor = 'white';
qrContainer.style.padding = '20px';
qrContainer.style.borderRadius = '10px';
qrContainer.style.textAlign = 'center';
qrContainer.style.display = isHost ? 'block' : 'none';
qrContainer.style.zIndex = '100';

const qrTitle = document.createElement('h2');
qrTitle.textContent = 'Scan to Join:';
qrContainer.appendChild(qrTitle);

const qrCode = document.createElement('div');
qrCode.id = 'qrcode';
qrContainer.appendChild(qrCode);

const qrInfo = document.createElement('p');
qrInfo.id = 'qrInfo';
qrInfo.textContent = 'Room ID: ' + roomId;
qrContainer.appendChild(qrInfo);

document.body.appendChild(qrContainer);

// Game status message
const gameStatus = document.createElement('div');
gameStatus.style.position = 'absolute';
gameStatus.style.bottom = '80px';
gameStatus.style.left = '50%';
gameStatus.style.transform = 'translateX(-50%)';
gameStatus.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
gameStatus.style.color = 'white';
gameStatus.style.padding = '10px 20px';
gameStatus.style.borderRadius = '5px';
gameStatus.style.fontFamily = 'Arial, sans-serif';
gameStatus.style.fontSize = '18px';
gameStatus.style.zIndex = '100';
gameStatus.textContent = 'Waiting for players to join...';
document.body.appendChild(gameStatus);

// Update UI functions
function updateGameInfo() {
  let html = `<h2>Game Room: ${roomId}</h2>`;
  html += `<p>Round: ${gameState.round}</p>`;
  
  if (activePlayer) {
    html += `<p>Current Turn: ${activePlayer.name}</p>`;
  } else {
    html += `<p>Waiting to start...</p>`;
  }
  
  gameInfo.innerHTML = html;
}

function updatePlayerList() {
  let html = '<h2>Players</h2>';
  
  players.forEach(player => {
    // Count remaining cups
    const remainingCups = playerCupStates[player.id] ? 
      playerCupStates[player.id].filter(cup => cup).length : 6;
    
    const isActive = activePlayer && player.id === activePlayer.id;
    const activeClass = isActive ? 'style="color: #4CAF50; font-weight: bold;"' : '';
    
    html += `<div ${activeClass}>
      ${player.name}: ${remainingCups} cups left
      ${!player.connected ? ' (Disconnected)' : ''}
    </div>`;
  });
  
  playerList.innerHTML = html;
}

// Ball reset function
function resetBall() {
  ballInFlight = false;
  ballBody.position.set(0, 1, -3); // Reset position
  ballBody.velocity.set(0, 0, 0);  // Stop movement
  ballBody.angularVelocity.set(0, 0, 0); // Stop rotation
}

// Check if ball needs to be reset
function checkBallReset() {
  const pos = ballBody.position;
  const vel = ballBody.velocity;
  const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  
  // Reset if out of bounds or if it's been moving too long with low speed
  if (pos.y < -2 || pos.x < -10 || pos.x > 10 || pos.z < -10 || pos.z > 10 || 
      (Date.now() - lastThrowTime > resetDelay && speed < 0.3 && ballInFlight)) {
    resetBall();
    
    // Notify server that the throw missed
    if (isHost && activePlayer) {
      socket.emit('cupMiss', { roomId });
      gameStatus.textContent = `${activePlayer.name}'s throw missed!`;
    }
  }
}

// Clear all cups from the scene
function clearCups() {
  currentCups.forEach(cup => {
    scene.remove(cup.mesh);
    world.removeBody(cup.body);
  });
  currentCups = [];
}

// Load cups for specific player
function loadPlayerCups(playerId) {
  // Clear existing cups
  clearCups();
  
  // Get the cup state for this player or create new one
  const cupState = playerCupStates[playerId] || Array(6).fill(true);
  
  // Create new cups
  currentCups = createCups();
  
  // Apply the cup state (hide cups that are already hit)
  currentCups.forEach((cup, index) => {
    if (!cupState[index]) {
      scene.remove(cup.mesh);
      cup.active = false;
    }
  });
}

// Collision detection for cups
ballBody.addEventListener('collide', (event) => {
  if (!gameStarted || !ballInFlight || !isHost) return;
  
  const otherBody = event.body;
  
  // Find if we hit a cup
  const hitCupIndex = currentCups.findIndex(cup => cup.body === otherBody && cup.active);
  
  if (hitCupIndex >= 0) {
    const hitCup = currentCups[hitCupIndex];
    
    // Check if the ball is above the cup's midpoint (successful throw)
    if (ballBody.position.y > hitCup.body.position.y + 0.15) {
      // Hide the cup
      scene.remove(hitCup.mesh);
      hitCup.active = false;
      
      // Update the player's cup state
      if (activePlayer) {
        const playerCups = playerCupStates[activePlayer.id];
        if (playerCups) {
          playerCups[hitCup.index] = false;
          
          // Notify server about the hit
          socket.emit('cupHit', {
            roomId,
            cupIndex: hitCup.index,
            playerId: activePlayer.id
          });
          
          gameStatus.textContent = `${activePlayer.name} hit a cup!`;
          
          // Reset ball
          resetBall();
        }
      }
    }
  }
});

// Start button click handler
startButton.addEventListener('click', () => {
  if (isHost && players.length > 0) {
    socket.emit('startGame', roomId);
    startButton.style.display = 'none';
    qrContainer.style.display = 'none';
  }
});

// Socket.io event handlers
socket.on('connect', () => {
  if (isHost || isSpectator) {
    // Join the room without being a controller
    socket.emit('joinRoom', {
      roomId: roomId,
      isController: false
    });
  }
});

socket.on('joinResponse', (data) => {
  if (data.success) {
    if (isHost) {
      // Generate QR code for joining
      const joinUrl = `${window.location.origin}/controller.html?room=${roomId}`;
      
      if (typeof QRCode !== 'undefined') {
        new QRCode(document.getElementById('qrcode'), {
          text: joinUrl,
          width: 200,
          height: 200,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.H
        });
        
        qrInfo.textContent = `Room ID: ${roomId}`;
      } else {
        qrCode.textContent = 'QR code library not loaded. Use this link:';
        const link = document.createElement('a');
        link.href = joinUrl;
        link.textContent = joinUrl;
        link.target = '_blank';
        qrCode.appendChild(document.createElement('br'));
        qrCode.appendChild(link);
      }
    }
  } else {
    alert(`Failed to join game: ${data.message}`);
    window.location.href = '/';
  }
});

socket.on('roomUpdate', (roomData) => {
  players = roomData.players;
  updatePlayerList();
  updateGameInfo();
  
  if (isHost) {
    startButton.disabled = players.length === 0;
  }
});

socket.on('gameStarted', (data) => {
  gameStarted = true;
  activePlayer = players.find(p => p.id === data.firstPlayer);
  
  // Hide UI elements
  if (isHost) {
    startButton.style.display = 'none';
    qrContainer.style.display = 'none';
  }
  
  // Initialize all player cup states if not already done
  players.forEach(player => {
    if (!playerCupStates[player.id]) {
      playerCupStates[player.id] = Array(6).fill(true);
    }
  });
  
  // Load the cups for the first player
  if (activePlayer) {
    loadPlayerCups(activePlayer.id);
    gameStatus.textContent = `Game started! ${activePlayer.name}'s turn`;
  }
  
  updateGameInfo();
  updatePlayerList();
});

socket.on('throw', (data) => {
  if (gameStarted && !ballInFlight) {
    // Extract velocity data
    const velocityData = data.velocity;
    
    // Reset ball position for throw
    ballBody.position.set(0, 1, -3);
    
    // Apply the velocity
    ballBody.velocity.set(
      velocityData.x,
      velocityData.y,
      velocityData.z
    );
    
    // Apply a small random rotation to make it more realistic
    ballBody.angularVelocity.set(
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 5
    );
    
    // Update game state
    ballInFlight = true;
    lastThrowTime = Date.now();
    
    // Update status
    gameStatus.textContent = `${activePlayer ? activePlayer.name : 'Player'} is throwing...`;
  }
});

socket.on('turnChange', (data) => {
  activePlayer = data.activePlayer;
  
  // Update game status
  gameStatus.textContent = `${activePlayer.name}'s turn`;
  
  // Load the cups for the current player
  loadPlayerCups(activePlayer.id);
  
  // Update UI
  updateGameInfo();
  updatePlayerList();
  
  // Make sure ball is reset
  resetBall();
});

socket.on('playerWon', (data) => {
  const winner = data.player;
  gameStatus.textContent = `🏆 ${winner.name} won the game! 🏆`;
  gameStarted = false;
  
  // Display final scores after a delay
  setTimeout(() => {
    let scoreText = 'Final Scores:\n';
    for (const [playerId, score] of Object.entries(data.scores)) {
      const player = players.find(p => p.id === playerId);
      if (player) {
        scoreText += `${player.name}: ${score} points\n`;
      }
    }
    alert(scoreText);
  }, 2000);
});

socket.on('playerDisconnected', (data) => {
  // Update the active player if needed
  if (data.activePlayer) {
    activePlayer = data.activePlayer;
    
    // Load the cups for the current player
    loadPlayerCups(activePlayer.id);
    
    // Update status
    gameStatus.textContent = `Player disconnected. ${activePlayer.name}'s turn`;
  }
  
  updatePlayerList();
});

socket.on('roomClosed', () => {
  alert('The game room has been closed.');
  window.location.href = '/';
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  
  // Physics step
  world.step(1 / 60); 
  
  // Sync ball mesh with physics body
  ballMesh.position.copy(ballBody.position);
  ballMesh.quaternion.copy(ballBody.quaternion);
  
  // Check if ball needs reset
  if (ballInFlight && gameStarted) {
    checkBallReset();
  }
  
  renderer.render(scene, camera);
}

animate();

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});