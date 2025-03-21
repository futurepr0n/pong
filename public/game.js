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

// Cups
const cupRadius = 0.2;
const cupHeight = 0.5;
const cups = [];
const cupPositions = [
    [0, 0, 2.5],             // Center front
    [0.45, 0, 2.5],          // Right front
    [-0.45, 0, 2.5],         // Left front
    [0.225, 0, 2.1],         // Right middle
    [-0.225, 0, 2.1],        // Left middle
    [0, 0, 1.7]              // Back
];

cupPositions.forEach((pos) => {
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
        active: true  // Flag to track if cup is still in play
    });
});

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

// Visual feedback elements
const throwFeedback = document.createElement('div');
throwFeedback.style.position = 'absolute';
throwFeedback.style.top = '20px';
throwFeedback.style.left = '20px';
throwFeedback.style.color = 'white';
throwFeedback.style.fontSize = '18px';
throwFeedback.style.fontFamily = 'Arial, sans-serif';
throwFeedback.style.backgroundColor = 'rgba(0,0,0,0.5)';
throwFeedback.style.padding = '10px';
throwFeedback.style.borderRadius = '5px';
document.body.appendChild(throwFeedback);

// Score display
const scoreDisplay = document.createElement('div');
scoreDisplay.style.position = 'absolute';
scoreDisplay.style.top = '20px';
scoreDisplay.style.right = '20px';
scoreDisplay.style.color = 'white';
scoreDisplay.style.fontSize = '24px';
scoreDisplay.style.fontFamily = 'Arial, sans-serif';
scoreDisplay.style.backgroundColor = 'rgba(0,0,0,0.5)';
scoreDisplay.style.padding = '10px';
scoreDisplay.style.borderRadius = '5px';
scoreDisplay.innerHTML = 'Score: 0';
document.body.appendChild(scoreDisplay);

// Game state
let ballInFlight = false;
let lastThrowTime = 0;
const resetDelay = 5000; // 5 seconds
let score = 0;
let throwsAttempted = 0;

// Ball reset function
function resetBall() {
    ballInFlight = false;
    ballBody.position.set(0, 1, -3); // Reset position
    ballBody.velocity.set(0, 0, 0);  // Stop movement
    ballBody.angularVelocity.set(0, 0, 0); // Stop rotation
    throwFeedback.textContent = 'Ready for next throw';
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
    }
}

// Collision detection for cups
ballBody.addEventListener('collide', (event) => {
    const otherBody = event.body;
    
    // Find if we hit a cup
    const hitCupIndex = cups.findIndex(cup => cup.body === otherBody && cup.active);
    
    if (hitCupIndex >= 0) {
        const hitCup = cups[hitCupIndex];
        
        // Check if the ball is above the cup's midpoint (successful throw)
        if (ballBody.position.y > hitCup.body.position.y + (cupHeight * 0.3)) {
            // Hide the cup
            scene.remove(hitCup.mesh);
            hitCup.active = false;
            
            // Increment score
            score += 1;
            scoreDisplay.innerHTML = `Score: ${score}`;
            
            // Visual feedback
            throwFeedback.textContent = '🎉 Cup hit! +1 point';
            throwFeedback.style.color = '#00ff00';
            
            // Reset ball after a delay
            setTimeout(resetBall, 1500);
        }
    }
});

// Handle throw event from controller
socket.on('throw', (throwData) => {
    const velocityData = throwData.velocity || throwData; // Backward compatibility
    
    // Calculate a ball launch position that feels natural
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
    throwsAttempted++;
    
    // Add visual feedback
    if (throwData.power) {
        const powerPercent = Math.round(throwData.power * 100 / 1.5);
        throwFeedback.textContent = `Throw power: ${powerPercent}%`;
        throwFeedback.style.color = 'white';
    } else {
        throwFeedback.textContent = 'Ball thrown';
        throwFeedback.style.color = 'white';
    }
    
    console.log('Applied velocity:', ballBody.velocity);
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
    if (ballInFlight) {
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