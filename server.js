// server.js - Önceki hatasız hali, değişiklik yok
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Sabit ayarlar
const DAY_DURATION = 90;    // saniye (gündüz tartışma)
const NIGHT_DURATION = 45;  // saniye (gece vampire eylemi)
const MIN_PLAYERS_TO_START = 5;

// Odalar (public ve private)
let rooms = {
    "Salon-1": { id: "Salon-1", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" },
    "Salon-2": { id: "Salon-2", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" },
    "Salon-3": { id: "Salon-3", max: 10, players: {}, state: "LOBBY", adminId: null, type: "public" }
};

io.on('connection', (socket) => {
    console.log(`Yeni bağlantı: ${socket.id}`);

    // Genel oda listesini güncelle (sadece public)
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

    // Özel oda oluşturma
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

    // Odaya katılma
    socket.on('join-room', (data) => {
        const { roomId, username, avatar } = data;
        let room = rooms[roomId];

        // Oda yoksa private olarak oluştur (ilk giren admin olur)
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

        // Oda dolu mu?
        if (Object.keys(room.players).length >= room.max) {
            return socket.emit('error-msg', 'Oda dolu!');
        }

        socket.join(roomId);

        // İlk giren admin olur
        const isFirstPlayer = Object.keys(room.players).length === 0;
        if (isFirstPlayer) room.adminId = socket.id;

        // Oyuncu ekle
        room.players[socket.id] = {
            id: socket.id,
            username: username || "Misafir",
            avatar: avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=default",
            isAdmin: isFirstPlayer,
            role: null,
            isAlive: true,
            hasVoted: false
        };

        // Odadaki herkese güncel oyuncu listesini gönder
        io.to(roomId).emit('update-room-players', {
            players: Object.values(room.players),
            adminId: room.adminId
        });

        // Yeni katılan kişiye mevcut oyuncuları WebRTC için gönder
        const otherPlayers = Object.values(room.players).filter(p => p.id !== socket.id);
        socket.emit('all-players', otherPlayers);

        updateGlobalRooms();
    });

    // OYUN BAŞLAT (Sadece admin)
    socket.on('start-game', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        if (room.adminId !== socket.id) {
            return socket.emit('error-msg', 'Sadece admin oyunu başlatabilir!');
        }
        if (Object.keys(room.players).length < MIN_PLAYERS_TO_START) {
            return socket.emit('error-msg', `Oyunu başlatmak için en az ${MIN_PLAYERS_TO_START} kişi gerekli!`);
        }

        room.state = "PLAYING";

        // Roller dağıt (şimdilik 1 vampire, geri kalan köylü)
        const players = Object.values(room.players);
        const vampireIndex = Math.floor(Math.random() * players.length);

        players.forEach((player, index) => {
            player.role = index === vampireIndex ? 'vampire' : 'villager';
            player.isAlive = true;
            player.hasVoted = false;
            io.to(player.id).emit('role-assigned', player.role);
        });

        io.to(roomId).emit('new-message', { user: "SİSTEM", text: "🧛 Oyun başladı! Roller dağıtıldı. Gündüz fazı başlıyor..." });
        startDayPhase(roomId);
    });

    // GÜNDÜZ FAZI
    function startDayPhase(roomId) {
        const room = rooms[roomId];
        if (!room || room.state !== "PLAYING") return;

        room.phase = "day";
        room.votes = {};
        room.timeLeft = DAY_DURATION;

        io.to(roomId).emit('phase-update', { phase: 'day', timeLeft: room.timeLeft });
        io.to(roomId).emit('vote-phase', { targets: Object.values(room.players) });
        io.to(roomId).emit('new-message', { user: "SİSTEM", text: "☀️ Gündüz oldu! Tartışın ve linç için oy verin." });

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomId).emit('phase-update', { phase: 'day', timeLeft: room.timeLeft });

            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                endDayPhase(roomId);
            }
        }, 1000);
    }

    // Oy kullanma
    socket.on('vote', ({ targetId }) => {
        const roomId = [...socket.rooms].find(r => rooms[r] && r !== socket.id);
        const room = rooms[roomId];
        if (!room || room.phase !== 'day' || !room.players[socket.id]?.isAlive) return;

        room.votes[socket.id] = targetId;
        room.players[socket.id].hasVoted = true;
    });

    // Gündüz bitişi ve linç
    function endDayPhase(roomId) {
        const room = rooms[roomId];
        const voteCount = {};
        Object.values(room.votes).forEach(target => {
            voteCount[target] = (voteCount[target] || 0) + 1;
        });

        let maxVotes = 0;
        let victimId = null;
        for (let id in voteCount) {
            if (voteCount[id] > maxVotes) {
                maxVotes = voteCount[id];
                victimId = id;
            }
        }

        let message = "Kimse çoğunluk oyu alamadı, linç olmadı.";
        if (victimId) {
            room.players[victimId].isAlive = false;
            message = `${room.players[victimId].username} linç edildi! (Rolü: ${room.players[victimId].role.toUpperCase()})`;
        }

        io.to(roomId).emit('vote-result', { victim: victimId ? room.players[victimId] : null, message });
        io.to(roomId).emit('new-message', { user: "SİSTEM", text: message });
        io.to(roomId).emit('update-room-players', { players: Object.values(room.players), adminId: room.adminId });

        checkWinCondition(roomId);
        if (room.state === "PLAYING") startNightPhase(roomId);
    }

    // GECE FAZI
    function startNightPhase(roomId) {
        const room = rooms[roomId];
        if (!room || room.state !== "PLAYING") return;

        room.phase = "night";
        room.nightActions = {};
        room.timeLeft = NIGHT_DURATION;

        io.to(roomId).emit('phase-update', { phase: 'night', timeLeft: room.timeLeft });
        io.to(roomId).emit('new-message', { user: "SİSTEM", text: "🌙 Gece oldu. Vampirler avlanıyor..." });

        // Sadece hayattaki vampire'lara hedef seçimi gönder
        Object.values(room.players).forEach(player => {
            if (player.isAlive && player.role === 'vampire') {
                io.to(player.id).emit('night-action-required', { targets: Object.values(room.players) });
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

    // Vampire gece eylemi
    socket.on('night-action', ({ targetId }) => {
        const roomId = [...socket.rooms].find(r => rooms[r] && r !== socket.id);
        const room = rooms[roomId];
        if (!room || room.phase !== 'night') return;

        const player = room.players[socket.id];
        if (!player || player.role !== 'vampire' || !player.isAlive) return;

        room.nightActions[socket.id] = targetId;
    });

    // Gece bitişi ve öldürme
    function endNightPhase(roomId) {
        const room = rooms[roomId];
        let killTarget = null;

        // Tüm vampire eylemlerinden birini seç (basit: ilk gelen)
        for (let sid in room.nightActions) {
            killTarget = room.nightActions[sid];
            break;
        }

        let message = "Bu gece kimse ölmedi.";
        if (killTarget && room.players[killTarget]?.isAlive) {
            room.players[killTarget].isAlive = false;
            message = `${room.players[killTarget].username} vampire kurbanı oldu! (Rolü: ${room.players[killTarget].role.toUpperCase()})`;
        }

        io.to(roomId).emit('new-message', { user: "SİSTEM", text: message });
        io.to(roomId).emit('update-room-players', { players: Object.values(room.players), adminId: room.adminId });

        checkWinCondition(roomId);
        if (room.state === "PLAYING") startDayPhase(roomId);
    }

    // Kazanma kontrolü
    function checkWinCondition(roomId) {
        const room = rooms[roomId];
        const alivePlayers = Object.values(room.players).filter(p => p.isAlive);
        const aliveVampires = alivePlayers.filter(p => p.role === 'vampire').length;

        if (aliveVampires === 0) {
            endGame(roomId, 'village', 'Köylüler tüm vampire\'ları yok etti! ☀️');
        } else if (aliveVampires >= alivePlayers.length / 2) {
            endGame(roomId, 'vampire', 'Vampirler köyü ele geçirdi! 🧛');
        }
    }

    // Oyun bitişi
    function endGame(roomId, winner, message) {
        const room = rooms[roomId];
        if (!room) return;

        room.state = "LOBBY";
        clearInterval(room.timer);

        io.to(roomId).emit('game-over', { winner, message });
        io.to(roomId).emit('new-message', { user: "SİSTEM", text: `🎉 OYUN BİTTİ! ${message}` });
    }

    // WebRTC Signaling
    socket.on('sending-signal', (payload) => {
        io.to(payload.userToSignal).emit('user-joined-signal', {
            signal: payload.signal,
            callerID: payload.callerID
        });
    });

    socket.on('returning-signal', (payload) => {
        io.to(payload.callerID).emit('receiving-returned-signal', {
            signal: payload.signal,
            id: socket.id
        });
    });

    // Chat mesajı
    socket.on('send-message', (text) => {
        const roomId = [...socket.rooms].find(r => rooms[r] && r !== socket.id);
        const room = rooms[roomId];
        if (!room || !room.players[socket.id]) return;

        const username = room.players[socket.id].username;
        io.to(roomId).emit('new-message', { user: username, text });
    });

    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        console.log(`Bağlantı kesildi: ${socket.id}`);

        for (let roomId in rooms) {
            const room = rooms[roomId];
            if (room.players[socket.id]) {
                delete room.players[socket.id];

                // Admin gittiğinde yeni admin ata
                if (room.adminId === socket.id && Object.keys(room.players).length > 0) {
                    const newAdminId = Object.keys(room.players)[0];
                    room.adminId = newAdminId;
                    room.players[newAdminId].isAdmin = true;
                }

                // Oda boşaldıysa ve private ise sil
                if (Object.keys(room.players).length === 0 && room.type === "private") {
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit('update-room-players', {
                        players: Object.values(room.players),
                        adminId: room.adminId
                    });
                }

                updateGlobalRooms();
                break;
            }
        }
    });
});

// Sunucuyu başlat
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`VK ROYALS SERVER ÇALIŞIYOR → http://localhost:${PORT}`);
});