const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Keep track of connections for debugging
let activeConnections = 0;

io.on('connection', (socket) => {
  activeConnections++;
  console.log(`Client connected: ${socket.id} (Total: ${activeConnections})`);

  // When the controller sends a throw
  socket.on('throw', (data) => {
    try {
      // Extract velocity data regardless of format
      const velocityData = data.velocity || data;
      
      // Log the throw data in a readable format
      console.log(`Throw from ${socket.id}:`);
      
      if (data.magnitude !== undefined) {
        console.log(`  Magnitude: ${data.magnitude.toFixed(2)}`);
      }
      
      if (data.duration !== undefined) {
        console.log(`  Duration: ${data.duration.toFixed(2)}s`);
      }
      
      // Always log the velocity components
      console.log(`  Velocity: X=${velocityData.x.toFixed(2)}, Y=${velocityData.y.toFixed(2)}, Z=${velocityData.z.toFixed(2)}`);
      
      // Broadcast the throw data to all connected clients
      io.emit('throw', data);
    } catch (error) {
      console.error('Error processing throw data:', error);
      console.error('Received data:', JSON.stringify(data));
    }
  });

  // Handle client disconnection
  socket.on('disconnect', () => {
    activeConnections--;
    console.log(`Client disconnected: ${socket.id} (Total: ${activeConnections})`);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Open /game.html in a browser to view the game');
  console.log('Open /controller.html on a mobile device to control the game');
});