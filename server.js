const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// Tüm dosyalar kök dizinde olduğu için express.static'i "." (mevcut dizin) yapıyoruz
app.use(express.static(__dirname));

const rooms = {};

io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, nickname, avatar }) => {
        socket.join(roomId);
        if (!rooms[roomId]) rooms[roomId] = [];
        const userData = { id: socket.id, nickname, avatar };
        rooms[roomId].push(userData);

        const otherUsers = rooms[roomId].filter(u => u.id !== socket.id);
        socket.emit('all-users', otherUsers);
        io.to(roomId).emit('room-update', rooms[roomId]);
    });

    socket.on('sending-signal', p => {
        io.to(p.userToSignal).emit('user-joined', { signal: p.signal, callerID: p.callerID });
    });

    socket.on('returning-signal', p => {
        io.to(p.callerID).emit('receiving-returned-signal', { signal: p.signal, id: socket.id });
    });

    socket.on('send-chat', (data) => {
        io.to(data.roomId).emit('receive-chat', {
            sender: data.nickname,
            message: data.message,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        });
    });

    socket.on('disconnect', () => {
        for (const rId in rooms) {
            rooms[rId] = rooms[rId].filter(u => u.id !== socket.id);
            io.to(rId).emit('room-update', rooms[rId]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
