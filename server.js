const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

let waitingUsers = [];

io.on('connection', (socket) => {
    socket.on('join-random', (userData) => {
        socket.userData = userData;
        if (waitingUsers.length > 0) {
            const partner = waitingUsers.shift();
            const roomId = `room_${socket.id}_${partner.id}`;
            socket.join(roomId);
            partner.join(roomId);
            socket.emit('matched', { roomId, partner: partner.userData, partnerId: partner.id, initiator: true });
            partner.emit('matched', { roomId, partner: socket.userData, partnerId: socket.id, initiator: false });
        } else {
            waitingUsers.push(socket);
            socket.emit('waiting');
        }
    });

    socket.on('signal', data => {
        io.to(data.to).emit('signal', { from: socket.id, signal: data.signal });
    });

    socket.on('send-chat', data => {
        io.to(data.roomId).emit('receive-chat', data);
    });

    socket.on('disconnect', () => {
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
        io.emit('partner-disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
