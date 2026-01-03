// server.js - Önceki tam versiyon, değişiklik yok (Railway uyumlu)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();

// Statik dosyalar
app.use(express.static(__dirname));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Oyun mantığı (önceki tam kod)
let rooms = {
    "Salon-1": { id: "Salon-1", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" },
    "Salon-2": { id: "Salon-2", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" },
    "Salon-3": { id: "Salon-3", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" }
};

io.on('connection', (socket) => {
    const updateGlobalRooms = () => {
        io.emit('room-list', Object.values(rooms).filter(r => r.type === "public").map(r => ({
            id: r.id, count: Object.keys(r.players).length, max: r.max
        })));
    };
    updateGlobalRooms();

    socket.on('create-custom-room', ({ roomId, max }) => {
        if (!rooms[roomId]) {
            rooms[roomId] = { id: roomId, max: parseInt(max), players: {}, state: "LOBBY", adminId: socket.id, type: "private" };
            socket.emit('room-created-success', roomId);
        } else {
            socket.emit('error-msg', 'Oda var!');
        }
    });

    socket.on('join-room', (data) => {
        let roomId = data.roomId;
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
            username: data.username,
            avatar: data.avatar,
            isAdmin: isFirst,
            role: 'villager',
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
        if (room.adminId === socket.id && Object.keys(room.players).length >= 3) {
            room.state = "PLAYING";
            const players = Object.values(room.players);
            const vampireIdx = Math.floor(Math.random() * players.length);
            players.forEach((p, index) => {
                p.role = (index === vampireIdx) ? 'vampire' : 'villager';
                io.to(p.id).emit('role-assigned', p.role);
            });
            io.to(roomId).emit('new-message', { user: "SİSTEM", text: "Oyun Başladı!" });
        } else {
            socket.emit('error-msg', 'Başlatmak için en az 3 kişi lazım!');
        }
    });

    socket.on('sending-signal', p => io.to(p.userToSignal).emit('user-joined-signal', { signal: p.signal, callerID: p.callerID }));
    socket.on('returning-signal', p => io.to(p.callerID).emit('receiving-returned-signal', { signal: p.signal, id: socket.id }));

    socket.on('disconnect', () => {
        for (let rId in rooms) {
            if (rooms[rId].players[socket.id]) {
                delete rooms[rId].players[socket.id];
                if (rooms[rId].adminId === socket.id) {
                    const remaining = Object.keys(rooms[rId].players);
                    rooms[rId].adminId = remaining.length > 0 ? remaining[0] : null;
                    if (remaining.length > 0) rooms[rId].players[remaining[0]].isAdmin = true;
                }
                if (Object.keys(rooms[rId].players).length === 0 && rooms[rId].type === "private") delete rooms[rId];
                else io.to(rId).emit('update-room-players', { players: Object.values(rooms[rId].players), adminId: rooms[rId].adminId });
                updateGlobalRooms();
                break;
            }
        }
    });
});

server.listen(3000, () => console.log('VK ROYALS SERVER RUNNING ON 3000'));
