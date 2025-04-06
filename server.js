const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const os = require('os');
const pty = require('node-pty');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Determine the shell based on the OS. Adjust if you use a different shell (e.g., zsh).
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle WebSocket connections
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- PTY Creation ---
    // Create a pseudo-terminal process for this specific connection
    const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color', // Emulate an xterm terminal with color support
        cols: 80,            // Initial dimensions, will be updated by client
        rows: 30,
        cwd: process.env.HOME, // Start in the user's home directory
        env: process.env     // Pass the environment variables
    });

    console.log(`PTY created for ${socket.id} with PID: ${ptyProcess.pid}`);

    // --- Data Flow ---

    // 1. PTY Output -> Client (WebSocket)
    // Send data from the pseudo-terminal's output back to the client's browser
    ptyProcess.onData((data) => {
        socket.emit('pty-output', data); // Send raw data (includes escape codes)
    });

    // Handle errors from PTY process
    ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`PTY process ${ptyProcess.pid} exited with code ${exitCode}, signal ${signal}`);
        // Optionally notify the client
        socket.emit('pty-output', `\r\n--- Terminal process exited (code: ${exitCode}) ---\r\n`);
        // Clean up? (Socket will disconnect naturally, or you could force it)
    });


    // 2. Client Input (WebSocket) -> PTY
    // Receive data typed by the user in the browser terminal and write it to the PTY
    socket.on('pty-input', (data) => {
        ptyProcess.write(data);
    });


    // 3. Client Resize (WebSocket) -> PTY
    // Receive terminal resize events from the client and resize the PTY accordingly
    socket.on('pty-resize', (size) => {
        if (size && typeof size.cols === 'number' && typeof size.rows === 'number') {
            console.log(`Resizing PTY ${ptyProcess.pid} to ${size.cols}x${size.rows}`);
            try {
                 // Validate size before resizing to prevent errors
                 if (size.cols > 0 && size.rows > 0) {
                    ptyProcess.resize(size.cols, size.rows);
                 } else {
                    console.warn(`Invalid resize dimensions received: ${size.cols}x${size.rows}`);
                 }
            } catch (e) {
                console.error("Error resizing PTY:", e);
            }
        } else {
            console.warn("Invalid resize data received:", size);
        }
    });

    // --- Cleanup on Disconnect ---
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}. Killing PTY process ${ptyProcess.pid}`);
        ptyProcess.kill(); // IMPORTANT: Kill the pty process when the client disconnects
    });
});

server.listen(PORT, () => {
    console.log(`Web Console server (with PTY) running at http://<YOUR_PI_IP>:${PORT}`);
});
