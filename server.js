const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

const rooms = {};

io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, nickname, avatar }) => {
        socket.join(roomId);
        if (!rooms[roomId]) rooms[roomId] = [];
        rooms[roomId].push({ id: socket.id, nickname, avatar });
        
        const otherUsers = rooms[roomId].filter(u => u.id !== socket.id).map(u => u.id);
        socket.emit('all-users', otherUsers);
        io.to(roomId).emit('room-update', rooms[roomId]);
    });

    socket.on('offer', payload => {
        io.to(payload.userToSignal).emit('offer', { sdp: payload.sdp, callerID: payload.callerID });
    });

    socket.on('answer', payload => {
        io.to(payload.callerID).emit('answer', { sdp: payload.sdp, id: socket.id });
    });

    socket.on('ice-candidate', payload => {
        io.to(payload.target).emit('ice-candidate', { candidate: payload.candidate, from: socket.id });
    });

    socket.on('send-chat', (data) => {
        io.to(data.roomId).emit('receive-chat', data);
    });

    socket.on('disconnect', () => {
        for (const rId in rooms) {
            rooms[rId] = rooms[rId].filter(u => u.id !== socket.id);
            io.to(rId).emit('room-update', rooms[rId]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`VK Royals running on ${PORT}`));
