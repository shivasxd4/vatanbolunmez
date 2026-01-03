// server.js - VK ROYALS | RAILWAY'DE TAM ÇALIŞAN VERSİYON
// Statik dosyalar (index.html, app.js, style.css) doğrudan servis ediliyor
// Socket.io + WebRTC + Oyun mantığı tam

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();

// STATİK DOSYALARI SERVİS ET (EN ÖNEMLİ KISIM!)
app.use(express.static(__dirname));

// Tüm istekleri index.html'e yönlendir (SPA için)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Sabit ayarlar
const DAY_DURATION = 90;    // saniye
const NIGHT_DURATION = 45;  // saniye
const MIN_PLAYERS_TO_START = 5;

// Odalar
let rooms = {
    "Salon-1": { id: "Salon-1", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" },
    "Salon-2": { id: "Salon-2", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" },
    "Salon-3": { id: "Salon-3", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" }
};

io.on('connection', (socket) => {
    console.log(`Bağlantı kuruldu: ${socket.id}`);

    const updateGlobalRooms = () => {
        const publicRooms = Object.values(rooms)
            .filter(r => r.type === "public")
            .map(r => ({
                id: r.id,
                count: Object.keys(r.players).length,
                max: r.max
            }));
        io.emit('room-list', publicRooms);
    };
    updateGlobalRooms();

    // Özel oda oluştur
    socket.on('create-custom-room', ({ roomId, max }) => {
        if (rooms[roomId]) {
            return socket.emit('error-msg', 'Bu oda adı zaten kullanılıyor!');
        }
        rooms[roomId] = {
            id: roomId,
            max: parseInt(max) || 10,
            players: {},
            state: "LOBBY",
            adminId: null,
            type: "private"
        };
        socket.emit('room-created-success', roomId);
    });

    // Odaya katıl
    socket.on('join-room', (data) => {
        const { roomId, username, avatar } = data;
        let room = rooms[roomId];

        if (!room) {
            room = rooms[roomId] = {
                id: roomId,
                max: 10,
                players: {},
                state: "LOBBY",
                adminId: socket.id,
                type: "private"
            };
        }

        if (Object.keys(room.players).length >= room.max) {
            return socket.emit('error-msg', 'Oda dolu!');
        }

        socket.join(roomId);

        const isFirstPlayer = Object.keys(room.players).length === 0;
        if (isFirstPlayer) room.adminId = socket.id;

        room.players[socket.id] = {
            id: socket.id,
            username: username || "Misafir",
            avatar: avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=default",
            isAdmin: isFirstPlayer,
            role: null,
            isAlive: true
        };

        io.to(roomId).emit('update-room-players', {
            players: Object.values(room.players),
            adminId: room.adminId
        });

        const otherPlayers = Object.values(room.players).filter(p => p.id !== socket.id);
        socket.emit('all-players', otherPlayers);

        updateGlobalRooms();
    });

    // Oyun başlat
    socket.on('start-game', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.adminId !== socket.id || Object.keys(room.players).length < MIN_PLAYERS_TO_START) {
            return socket.emit('error-msg', `En az ${MIN_PLAYERS_TO_START} kişi gerekli!`);
        }

        room.state = "PLAYING";
        const players = Object.values(room.players);
        const vampireIndex = Math.floor(Math.random() * players.length);

        players.forEach((player, index) => {
            player.role = index === vampireIndex ? 'vampire' : 'villager';
            player.isAlive = true;
            io.to(player.id).emit('role-assigned', player.role);
        });

        io.to(roomId).emit('new-message', { user: "SİSTEM", text: "Oyun başladı! Gündüz fazı..." });
        startDayPhase(roomId);
    });

    function startDayPhase(roomId) {
        const room = rooms[roomId];
        if (!room || room.state !== "PLAYING") return;

        room.phase = "day";
        room.votes = {};
        room.timeLeft = DAY_DURATION;

        io.to(roomId).emit('phase-update', { phase: 'day', timeLeft: room.timeLeft });
        io.to(roomId).emit('vote-phase', { targets: Object.values(room.players) });
        io.to(roomId).emit('new-message', { user: "SİSTEM", text: "☀️ Gündüz oldu! Oy verin." });

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomId).emit('phase-update', { phase: 'day', timeLeft: room.timeLeft });
            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                endDayPhase(roomId);
            }
        }, 1000);
    }

    socket.on('vote', ({ targetId }) => {
        const roomId = [...socket.rooms].find(r => rooms[r] && r !== socket.id);
        const room = rooms[roomId];
        if (!room || room.phase !== 'day' || !room.players[socket.id]?.isAlive) return;
        room.votes[socket.id] = targetId;
    });

    function endDayPhase(roomId) {
        const room = rooms[roomId];
        const voteCount = {};
        Object.values(room.votes).forEach(v => voteCount[v] = (voteCount[v] || 0) + 1);

        let victimId = null;
        let max = 0;
        for (let id in voteCount) {
            if (voteCount[id] > max) {
                max = voteCount[id];
                victimId = id;
            }
        }

        let message = "Linç olmadı.";
        if (victimId) {
            room.players[victimId].isAlive = false;
            message = `${room.players[victimId].username} linç edildi! (Rol: ${room.players[victimId].role.toUpperCase()})`;
        }

        io.to(roomId).emit('vote-result', { message });
        io.to(roomId).emit('new-message', { user: "SİSTEM", text: message });
        io.to(roomId).emit('update-room-players', { players: Object.values(room.players), adminId: room.adminId });

        checkWinCondition(roomId);
        if (room.state === "PLAYING") startNightPhase(roomId);
    }

    function startNightPhase(roomId) {
        const room = rooms[roomId];
        room.phase = "night";
        room.nightActions = {};
        room.timeLeft = NIGHT_DURATION;

        io.to(roomId).emit('phase-update', { phase: 'night', timeLeft: room.timeLeft });
        io.to(roomId).emit('new-message', { user: "SİSTEM", text: "🌙 Gece oldu..." });

        Object.values(room.players).forEach(p => {
            if (p.isAlive && p.role === 'vampire') {
                io.to(p.id).emit('night-action-required', { targets: Object.values(room.players) });
            }
        });

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomId).emit('phase-update', { phase: 'night', timeLeft: room.timeLeft });
            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                endNightPhase(roomId);
            }
        }, 1000);
    }

    socket.on('night-action', ({ targetId }) => {
        const roomId = [...socket.rooms].find(r => rooms[r] && r !== socket.id);
        const room = rooms[roomId];
        if (!room || room.phase !== 'night' || room.players[socket.id]?.role !== 'vampire') return;
        room.nightActions[socket.id] = targetId;
    });

    function endNightPhase(roomId) {
        const room = rooms[roomId];
        let killTarget = null;
        for (let sid in room.nightActions) {
            killTarget = room.nightActions[sid];
            break;
        }

        let message = "Kimse ölmedi.";
        if (killTarget && room.players[killTarget]?.isAlive) {
            room.players[killTarget].isAlive = false;
            message = `${room.players[killTarget].username} vampire kurbanı! (Rol: ${room.players[killTarget].role.toUpperCase()})`;
        }

        io.to(roomId).emit('new-message', { user: "SİSTEM", text: message });
        io.to(roomId).emit('update-room-players', { players: Object.values(room.players), adminId: room.adminId });

        checkWinCondition(roomId);
        if (room.state === "PLAYING") startDayPhase(roomId);
    }

    function checkWinCondition(roomId) {
        const room = rooms[roomId];
        const alive = Object.values(room.players).filter(p => p.isAlive);
        const vampiresAlive = alive.filter(p => p.role === 'vampire').length;

        if (vampiresAlive === 0) {
            endGame(roomId, 'village', 'Köylüler kazandı! ☀️');
        } else if (vampiresAlive >= alive.length / 2) {
            endGame(roomId, 'vampire', 'Vampirler kazandı! 🧛');
        }
    }

    function endGame(roomId, winner, message) {
        const room = rooms[roomId];
        room.state = "LOBBY";
        clearInterval(room.timer);
        io.to(roomId).emit('game-over', { winner, message });
        io.to(roomId).emit('new-message', { user: "SİSTEM", text: `OYUN BİTTİ! ${message}` });
    }

    // WebRTC Signaling
    socket.on('sending-signal', (payload) => io.to(payload.userToSignal).emit('user-joined-signal', { signal: payload.signal, callerID: payload.callerID }));
    socket.on('returning-signal', (payload) => io.to(payload.callerID).emit('receiving-returned-signal', { signal: payload.signal, id: socket.id }));

    // Chat
    socket.on('send-message', (text) => {
        const roomId = [...socket.rooms].find(r => rooms[r] && r !== socket.id);
        const room = rooms[roomId];
        if (room && room.players[socket.id]) {
            io.to(roomId).emit('new-message', { user: room.players[socket.id].username, text });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log(`Bağlantı kesildi: ${socket.id}`);
        for (let roomId in rooms) {
            const room = rooms[roomId];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                if (room.adminId === socket.id && Object.keys(room.players).length > 0) {
                    const newAdmin = Object.keys(room.players)[0];
                    room.adminId = newAdmin;
                    room.players[newAdmin].isAdmin = true;
                }
                if (Object.keys(room.players).length === 0 && room.type === "private") {
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit('update-room-players', { players: Object.values(room.players), adminId: room.adminId });
                }
                updateGlobalRooms();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`VK ROYALS SERVER ÇALIŞIYOR → Port: ${PORT}`);
});
