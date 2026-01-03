const express = require('express');
const path = require('path');
const app = express();

// Statik dosyaları servis et
app.use(express.static(__dirname));

// Tüm istekleri index.html'e yönlendir
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Railway port ve host ayarı
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
    console.log(`VK ROYALS SERVER ÇALIŞIYOR → Port: ${PORT}`);
});

// Socket.io
const { Server } = require('socket.io');
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

// Odalar
let rooms = {
    "Salon-1": { id: "Salon-1", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" },
    "Salon-2": { id: "Salon-2", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" },
    "Salon-3": { id: "Salon-3", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" }
};

const updateGlobalRooms = () => {
    io.emit('room-list', Object.values(rooms)
        .filter(r => r.type === "public")
        .map(r => ({ id: r.id, count: Object.keys(r.players).length, max: r.max })));
};

io.on('connection', (socket) => {
    console.log('Bağlanan:', socket.id);
    updateGlobalRooms();

    socket.on('create-custom-room', ({ roomId, max }) => {
        if (rooms[roomId]) return socket.emit('error-msg', 'Oda adı alınmış!');
        rooms[roomId] = { id: roomId, max: parseInt(max), players: {}, state: "LOBBY", adminId: socket.id, type: "private" };
        socket.emit('room-created-success', roomId);
    });

    socket.on('join-room', (data) => {
        let { roomId, username, avatar } = data;
        if (!rooms[roomId]) {
            rooms[roomId] = { id: roomId, max: 10, players: {}, state: "LOBBY", adminId: socket.id, type: "private" };
        }
        const room = rooms[roomId];
        if (Object.keys(room.players).length >= room.max) return socket.emit('error-msg', 'Oda dolu!');

        socket.join(roomId);
        const isFirst = Object.keys(room.players).length === 0;
        if (isFirst) room.adminId = socket.id;

        room.players[socket.id] = {
            id: socket.id,
            username: username || "Misafir",
            avatar: avatar,
            isAdmin: isFirst,
            role: null,
            isAlive: true
        };

        io.to(roomId).emit('update-room-players', {
            players: Object.values(room.players),
            adminId: room.adminId
        });

        socket.emit('all-players', Object.values(room.players).filter(p => p.id !== socket.id));
        updateGlobalRooms();
    });

    socket.on('start-game', (roomId) => {
        const room = rooms[roomId];
        if (room && room.adminId === socket.id && Object.keys(room.players).length >= 3) {
            room.state = "PLAYING";
            const players = Object.values(room.players);
            const vampireIdx = Math.floor(Math.random() * players.length);
            players.forEach((p, i) => {
                p.role = i === vampireIdx ? 'vampire' : 'villager';
                io.to(p.id).emit('role-assigned', p.role);
            });
            io.to(roomId).emit('new-message', { user: "SİSTEM", text: "Oyun başladı!" });
        }
    });

    // WebRTC Signaling
    socket.on('sending-signal', p => io.to(p.userToSignal).emit('user-joined-signal', { signal: p.signal, callerID: p.callerID }));
    socket.on('returning-signal', p => io.to(p.callerID).emit('receiving-returned-signal', { signal: p.signal, id: socket.id }));

    // Chat
    socket.on('send-message', (text) => {
        const roomId = [...socket.rooms].find(r => rooms[r] && r !== socket.id);
        if (roomId && rooms[roomId].players[socket.id]) {
            io.to(roomId).emit('new-message', { user: rooms[roomId].players[socket.id].username, text });
        }
    });

    socket.on('disconnect', () => {
        for (let rId in rooms) {
            if (rooms[rId].players[socket.id]) {
                delete rooms[rId].players[socket.id];
                io.to(rId).emit('update-room-players', { players: Object.values(rooms[rId].players), adminId: rooms[rId].adminId });
                if (Object.keys(rooms[rId].players).length === 0 && rooms[rId].type === "private") delete rooms[rId];
                updateGlobalRooms();
                break;
            }
        }
    });
});
