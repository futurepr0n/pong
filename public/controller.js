const socket = io();
const throwButton = document.getElementById('throwButton');
const statusDisplay = document.getElementById('statusDisplay');

// State variables
let initialOrientation = { beta: 0, gamma: 0 };
let currentOrientation = { beta: 0, gamma: 0 };
let isThrowing = false;
let throwStartTime = 0;
let orientationHistory = [];
let lastOrientationTime = 0;
let velocityReadings = [];
let motionPermissionGranted = false;

// Debug display
const debugElement = document.createElement('div');
debugElement.style.position = 'absolute';
debugElement.style.bottom = '10px';
debugElement.style.left = '10px';
debugElement.style.backgroundColor = 'rgba(255,255,255,0.7)';
debugElement.style.padding = '5px';
debugElement.style.fontFamily = 'monospace';
debugElement.style.fontSize = '12px';
debugElement.style.color = '#333';
document.body.appendChild(debugElement);

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
          statusDisplay.textContent = 'Motion permission granted. Hold to throw.';
          
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
    document.body.insertBefore(permissionButton, throwButton);
    
  } else {
    // Non-iOS or older iOS that doesn't need permission
    motionPermissionGranted = true;
    initOrientationTracking();
  }
}

// Initialize orientation tracking only after permission is granted
function initOrientationTracking() {
  window.addEventListener('deviceorientation', (event) => {
    // Update current orientation values
    if (event.beta !== null) currentOrientation.beta = event.beta;
    if (event.gamma !== null) currentOrientation.gamma = event.gamma;
    
    // Update debug display
    debugElement.textContent = `Current: β=${currentOrientation.beta.toFixed(1)}° γ=${currentOrientation.gamma.toFixed(1)}°`;
    if (isThrowing) {
      const betaDiff = currentOrientation.beta - initialOrientation.beta;
      const gammaDiff = currentOrientation.gamma - initialOrientation.gamma;
      debugElement.textContent += `\nDiff: β=${betaDiff.toFixed(1)}° γ=${gammaDiff.toFixed(1)}°`;
    }
    
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
  // This is simpler and more reliable than complex calculations
  
  // X velocity is based on gamma change (left/right tilt)
  // Negative gamma = throw right, positive gamma = throw left
  const xVelocity = gammaDiff * -0.3; // Invert and scale
  
  // Y velocity is based on beta change (forward/back tilt)
  // Negative beta diff = more upward throw, positive = more downward
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
  
  // Log detailed throw data
  console.log('Throw analysis:', {
    duration: throwDuration.toFixed(2) + 's',
    orientation: {
      start: { beta: initialOrientation.beta.toFixed(1), gamma: initialOrientation.gamma.toFixed(1) },
      end: { beta: currentOrientation.beta.toFixed(1), gamma: currentOrientation.gamma.toFixed(1) },
      change: { beta: betaDiff.toFixed(1), gamma: gammaDiff.toFixed(1) }
    },
    totalChange: totalChange.toFixed(1),
    samples: orientationHistory.length,
    velocity: velocity
  });
  
  // Display throw info
  statusDisplay.textContent = `Throw: ${totalChange.toFixed(1)}° motion`;
  
  // Send throw data to server
  socket.emit('throw', velocity);
});

// Connection feedback
socket.on('connect', () => {
  statusDisplay.textContent = 'Connected to server. Ready for setup.';
  // Initialize permissions after connection
  setupMotionPermission();
});

socket.on('disconnect', () => {
  statusDisplay.textContent = 'Disconnected from server.';
});