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
    // RASTGELE EŞLEŞME
    socket.on('join-random', (userData) => {
        socket.userData = userData;
        if (waitingUsers.length > 0) {
            const partner = waitingUsers.shift();
            const roomId = `random_${socket.id}_${partner.id}`;
            socket.join(roomId);
            partner.join(roomId);
            socket.emit('matched', { roomId, partner: partner.userData, partnerId: partner.id, initiator: true });
            partner.emit('matched', { roomId, partner: socket.userData, partnerId: socket.id, initiator: false });
        } else {
            waitingUsers.push(socket);
        }
    });

    // ÖZEL ODA KURMA/KATILMA
    socket.on('join-private', ({ roomId, userData, limit }) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const numClients = room ? room.size : 0;

        if (numClients < limit) {
            socket.join(roomId);
            socket.userData = userData;
            const otherUsers = Array.from(room || []).filter(id => id !== socket.id);
            socket.emit('private-joined', { roomId, otherUsers });
            socket.to(roomId).emit('user-connected', { id: socket.id, userData });
        } else {
            socket.emit('error-msg', 'Oda dolu kanka!');
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
        io.emit('user-disconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`VK V4 Aktif: ${PORT}`));
