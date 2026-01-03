const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

let randomQueue = [];

io.on('connection', (socket) => {
    // --- RASTGELE EŞLEŞME ---
    socket.on('join-random', (userData) => {
        socket.userData = userData;
        if (randomQueue.length > 0) {
            const partner = randomQueue.shift();
            const roomId = `rand_${socket.id}_${partner.id}`;
            socket.join(roomId);
            partner.join(roomId);

            // İki tarafa da eşleşme bilgisini gönder
            socket.emit('start-call', { targetId: partner.id, initiator: true, roomId });
            partner.emit('start-call', { targetId: socket.id, initiator: false, roomId });
        } else {
            randomQueue.push(socket);
        }
    });

    // --- ÖZEL ODA SİSTEMİ ---
    socket.on('join-private', ({ roomId, userData, limit }) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const size = room ? room.size : 0;

        if (size < limit) {
            socket.join(roomId);
            socket.userData = userData;
            socket.myPrivateRoom = roomId;

            // Odadaki diğer herkese "yeni biri geldi" de
            socket.to(roomId).emit('user-joined-room', { id: socket.id, userData });
            
            // Yeni gelene odadaki mevcut kullanıcıları bildir
            const otherUsers = Array.from(room || []).filter(id => id !== socket.id);
            socket.emit('existing-users', otherUsers);
        } else {
            socket.emit('error-msg', 'Oda dolu kanka!');
        }
    });

    // --- WEB RTC SİNYALLEŞME ---
    socket.on('signal', data => {
        io.to(data.to).emit('signal', { from: socket.id, signal: data.signal });
    });

    socket.on('disconnect', () => {
        randomQueue = randomQueue.filter(u => u.id !== socket.id);
        io.emit('user-left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`VK V7 PRO: ${PORT}`));
