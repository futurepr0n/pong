const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const isHost = urlParams.get('host') === 'true';
const isSpectator = urlParams.get('spectator') === 'true';
const hostToken = urlParams.get('token') || localStorage.getItem(`hostToken_${roomId}`);

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

// UI Elements
const qrModal = document.getElementById('qrModal');
const qrRoomID = document.getElementById('qrRoomID');
const qrcode = document.getElementById('qrcode');
const playerCount = document.getElementById('playerCount');
const playerListContainer = document.getElementById('playerListContainer');
const startGameBtn = document.getElementById('startGameBtn');
const closeQRModal = document.getElementById('closeQRModal');
const winnerModal = document.getElementById('winnerModal');
const winnerText = document.getElementById('winnerText');
const finalScores = document.getElementById('finalScores');
const newGameBtn = document.getElementById('newGameBtn');
const returnToLobbyBtn = document.getElementById('returnToLobbyBtn');

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

// QR Code modal button (for host to reopen modal if closed)
const showQRButton = document.createElement('button');
showQRButton.textContent = 'Show QR Code';
showQRButton.style.position = 'absolute';
showQRButton.style.bottom = '20px';
showQRButton.style.left = '20px';
showQRButton.style.zIndex = '100';
showQRButton.style.display = isHost ? 'block' : 'none';
showQRButton.addEventListener('click', () => {
  qrModal.style.display = 'flex';
});
document.body.appendChild(showQRButton);

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
  
  if (players.length === 0) {
    html += '<p>No players connected</p>';
  } else {
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
  }
  
  playerList.innerHTML = html;
}

function updatePlayerListInModal() {
  playerListContainer.innerHTML = '';
  
  if (players.length === 0) {
    playerListContainer.innerHTML = '<p>No players connected</p>';
  } else {
    const list = document.createElement('ol');
    
    players.forEach(player => {
      if (player.connected) {
        const item = document.createElement('li');
        item.textContent = player.name;
        list.appendChild(item);
      }
    });
    
    playerListContainer.appendChild(list);
  }
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
    if (isHost && activePlayer && gameStarted) {
      socket.emit('cupMiss', { roomId });
      gameStatus.textContent = `${activePlayer.name}'s throw missed!`;
      
      // Play miss sound
      try {
        const missSound = new Audio('https://actions.google.com/sounds/v1/impacts/dumpster_door_hit.ogg');
        missSound.volume = 0.3;
        missSound.play();
      } catch (e) {
        console.log('Sound not available');
      }
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

// Show QR code for joining
function showQRCode() {
  if (isHost) {
    qrRoomID.textContent = roomId;
    
    // Generate QR code
    qrcode.innerHTML = '';
    const joinUrl = `${window.location.origin}/controller.html?room=${roomId}`;
    
    new QRCode(qrcode, {
      text: joinUrl,
      width: 200,
      height: 200,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
    
    // Add link text below QR
    const linkEl = document.createElement('div');
    linkEl.style.marginTop = '10px';
    linkEl.style.wordBreak = 'break-all';
    linkEl.innerHTML = `<a href="${joinUrl}" target="_blank">${joinUrl}</a>`;
    qrcode.appendChild(linkEl);
    
    qrModal.style.display = 'flex';
    updatePlayerListInModal();
  }
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
        // Add visual effect for hit
        const hitFlash = new THREE.Mesh(
          new THREE.SphereGeometry(0.3, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.7 })
        );
        hitFlash.position.copy(hitCup.mesh.position);
        scene.add(hitFlash);
        
        // Animate and remove the flash
        const startTime = Date.now();
        const animateFlash = () => {
          const elapsed = Date.now() - startTime;
          if (elapsed > 500) {
            scene.remove(hitFlash);
            return;
          }
          
          hitFlash.material.opacity = 0.7 * (1 - elapsed / 500);
          hitFlash.scale.set(1 + elapsed / 250, 1 + elapsed / 250, 1 + elapsed / 250);
          
          requestAnimationFrame(animateFlash);
        };
        animateFlash();
        
        // Hide the cup
        scene.remove(hitCup.mesh);
        hitCup.active = false;
        
        // Update the player's cup state
        if (activePlayer) {
          const playerCups = playerCupStates[activePlayer.id];
          if (playerCups) {
            playerCups[hitCup.index] = false;
            
            // Count remaining cups
            const remainingCups = playerCups.filter(cup => cup).length;
            
            // Notify server about the hit
            socket.emit('cupHit', {
              roomId,
              cupIndex: hitCup.index,
              playerId: activePlayer.id,
              remainingCups: remainingCups
            });
            
            // Update game status with hit message
            gameStatus.textContent = `${activePlayer.name} hit a cup! (${remainingCups} cups left)`;
            
            // Play hit sound
            try {
              const hitSound = new Audio('https://actions.google.com/sounds/v1/sports/golf_ball_in_cup.ogg');
              hitSound.volume = 0.5;
              hitSound.play();
            } catch (e) {
              console.log('Sound not available');
            }
            
            // Reset ball
            resetBall();
          }
        }
      }
    }
  });
  
  // Button event listeners
  startGameBtn.addEventListener('click', () => {
    if (isHost) {
      // Only allow starting if we have at least 1 player
      if (players.length === 0) {
        alert('Need at least one player to start the game.');
        return;
      }
      
      startGameBtn.disabled = true;
      startGameBtn.textContent = 'Starting...';
      socket.emit('startGame', roomId);
    }
  });
  
  closeQRModal.addEventListener('click', () => {
    qrModal.style.display = 'none';
  });
  
  newGameBtn.addEventListener('click', () => {
    // Reset game and start a new one
    if (isHost) {
      socket.emit('resetGame', roomId);
      winnerModal.style.display = 'none';
    }
  });
  
  returnToLobbyBtn.addEventListener('click', () => {
    window.location.href = '/';
  });
  
  // Socket event handlers
  socket.on('connect', () => {
    console.log('Connected to server');
    
    if (isHost || isSpectator) {
      // Join the room with host token if available
      socket.emit('joinRoom', {
        roomId: roomId,
        isHost: isHost,
        isController: false,
        hostToken: hostToken
      });
    }
  });
  
  socket.on('joinResponse', (data) => {
    if (data.success) {
      // If we're the host, show the QR code
      if (isHost) {
        showQRCode();
      }
    } else {
      alert(`Failed to join game: ${data.message}`);
      window.location.href = '/';
    }
  });
  
  socket.on('roomUpdate', (data) => {
    players = data.players;
    
    updatePlayerList();
    updateGameInfo();
    
    // Update player count in QR modal
    if (isHost) {
      playerCount.textContent = players.filter(p => p.connected).length;
      updatePlayerListInModal();
      
      // Enable/disable start button based on player count
      startGameBtn.disabled = players.length === 0;
    }
  });
  
  socket.on('gameStarted', (data) => {
    // Close the QR code modal
    qrModal.style.display = 'none';
    
    gameStarted = true;
    activePlayer = players.find(p => p.id === data.firstPlayer);
    
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
    
    // Play start sound
    try {
      const startSound = new Audio('https://actions.google.com/sounds/v1/sports/tennis_racket_hitting_ball.ogg');
      startSound.volume = 0.5;
      startSound.play();
    } catch (e) {
      console.log('Sound not available');
    }
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
  
  socket.on('newRound', (data) => {
    gameState.round = data.round;
    gameStatus.textContent = `Round ${data.round} started! ${data.activePlayer.name}'s turn`;
    updateGameInfo();
  });
  
  socket.on('playerWon', (data) => {
    const winner = data.player;
    
    // Show winner modal
    if (data.isTie) {
      const tiedPlayers = data.tiedPlayers.map(p => p.name).join(' and ');
      winnerText.textContent = `It's a tie between ${tiedPlayers}!`;
    } else {
      winnerText.textContent = `🏆 ${winner.name} won the game! 🏆`;
    }
    
    // Display final scores
    let scoresHtml = '<h3>Final Scores</h3>';
    const scores = data.scores;
    
    // Create a sorted array of players by score
    const playerScores = Object.keys(scores).map(id => {
      const player = players.find(p => p.id === id);
      return {
        name: player ? player.name : 'Unknown Player',
        score: scores[id]
      };
    }).sort((a, b) => b.score - a.score);
    
    // Create HTML for scores
    playerScores.forEach((player, index) => {
      scoresHtml += `<div>${index + 1}. ${player.name}: ${player.score} points</div>`;
    });
    
    finalScores.innerHTML = scoresHtml;
    winnerModal.style.display = 'flex';
    
    // End game state
    gameStarted = false;
    
    // Play victory sound
    try {
      const winSound = new Audio('https://actions.google.com/sounds/v1/sports/crowd_cheer.ogg');
      winSound.volume = 0.5;
      winSound.play();
    } catch (e) {
      console.log('Sound not available');
    }
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
    if (isHost) {
      updatePlayerListInModal();
    }
  });
  
  socket.on('gameReset', (data) => {
    // Reset game state
    gameStarted = false;
    gameState.round = 1;
    activePlayer = null;
    playerCupStates = {};
    
    // Clear and reset cups
    clearCups();
    
    // Reset ball
    resetBall();
    
    // Hide winner modal if open
    winnerModal.style.display = 'none';
    
    // If host, show QR modal again
    if (isHost) {
      startGameBtn.disabled = false;
      startGameBtn.textContent = 'Start Game';
      showQRCode();
    }
    
    // Update UI
    updateGameInfo();
    updatePlayerList();
    gameStatus.textContent = 'Game reset. Waiting for players...';
  });
  
  socket.on('roomClosed', () => {
    alert('The game room has been closed.');
    window.location.href = '/';
  });
  
  socket.on('disconnect', () => {
    gameStatus.textContent = 'Disconnected from server. Trying to reconnect...';
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
  
  // Start the animation loop
  animate();
  
  // Handle window resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });