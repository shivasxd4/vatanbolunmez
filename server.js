const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Railway ve WebRTC için CORS ayarları
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Oda ve Kullanıcı Veritabanı (Ram üzerinde)
const usersInRooms = {};

io.on('connection', (socket) => {
    console.log('Bağlantı sağlandı:', socket.id);

    socket.on('join-room', ({ roomId, nickname, avatar }) => {
        socket.join(roomId);
        
        if (!usersInRooms[roomId]) {
            usersInRooms[roomId] = [];
        }

        const newUser = {
            id: socket.id,
            nickname: nickname,
            avatar: avatar
        };

        usersInRooms[roomId].push(newUser);

        // Yeni gelene odadaki diğer kişileri bildir (WebRTC için)
        const otherUsers = usersInRooms[roomId].filter(user => user.id !== socket.id);
        socket.emit('all-users', otherUsers);

        // Odadaki herkese güncel listeyi gönder (Arayüz güncellemesi için)
        io.to(roomId).emit('room-update', usersInRooms[roomId]);
    });

    // WebRTC Sinyalleşme Kanalları
    socket.on('sending-signal', payload => {
        io.to(payload.userToSignal).emit('user-joined', {
            signal: payload.signal,
            callerID: payload.callerID
        });
    });

    socket.on('returning-signal', payload => {
        io.to(payload.callerID).emit('receiving-returned-signal', {
            signal: payload.signal,
            id: socket.id
        });
    });

    // Chat Mesajlaşma
    socket.on('send-chat', (data) => {
        io.to(data.roomId).emit('receive-chat', {
            sender: data.nickname,
            message: data.message,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        });
    });

    // Bağlantı Koptuğunda
    socket.on('disconnect', () => {
        for (const roomId in usersInRooms) {
            usersInRooms[roomId] = usersInRooms[roomId].filter(u => u.id !== socket.id);
            io.to(roomId).emit('room-update', usersInRooms[roomId]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} üzerinde çalışıyor.`);
});
