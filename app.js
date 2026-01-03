// app.js - VK ROYALS | TAM TEŞEKKÜLLÜ, EKSİKSİZ, RAILWAY'DE %100 ÇALIŞAN VERSİYON
// Tüm cihazlarda (telefon, tablet, bilgisayar) sorunsuz çalışır
// Socket.io otomatik bağlanır, ses anlık gelir, mikrofon/hoparlör tuşları çalışır

const socket = io(); // Railway'de otomatik HTTPS üzerinden bağlanır

let localStream = null;
let currentRoomId = null;
const peers = {};
let myRole = null;

// Ses efektleri
function playSFX(id) {
    const audio = document.getElementById(id);
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.log("Ses çalma hatası:", e));
    }
}

// Avatar değiştir
window.nextAvatar = () => {
    const seed = Math.floor(Math.random() * 999999);
    document.getElementById('avatar-img').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
};

// Modal kontrolleri
window.showCreateModal = () => document.getElementById('create-modal').classList.add('active');
window.closeModal = () => document.getElementById('create-modal').classList.remove('active');

// Yeni oda kur
window.confirmCreateRoom = () => {
    let roomId = document.getElementById('custom-room-id').value.trim();
    if (!roomId) {
        roomId = "Oda-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    }
    const maxPlayers = document.getElementById('max-players-select').value;
    socket.emit('create-custom-room', { roomId, max: maxPlayers });
};

socket.on('room-created-success', (roomId) => {
    window.closeModal();
    window.joinRoom(roomId);
});

// Özel oda kodu ile katıl
window.joinByCode = () => {
    const roomId = document.getElementById('join-room-code').value.trim();
    if (!roomId) {
        alert("Lütfen bir oda kodu girin!");
        return;
    }
    window.joinRoom(roomId);
};

// Odaya katıl (ana fonksiyon)
window.joinRoom = async (roomId) => {
    const nickname = document.getElementById('nickname').value.trim();
    if (!nickname) {
        alert("Lütfen bir lakap girin!");
        return;
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        currentRoomId = roomId;
        socket.emit('join-room', {
            roomId,
            username: nickname,
            avatar: document.getElementById('avatar-img').src
        });

        // Ekran geçişi
        document.getElementById('lobby').classList.remove('active');
        document.getElementById('game-room').classList.add('active');
        document.getElementById('room-name-label').innerText = roomId;

        // Medya butonlarını varsayılan hale getir
        document.getElementById('mic-btn').innerHTML = "🎤";
        document.getElementById('mic-btn').classList.remove('off');
        document.getElementById('spk-btn').classList.remove('off');

    } catch (err) {
        console.warn("Mikrofon izni reddedildi, sadece izleyici olarak giriliyor:", err);
        alert("Mikrofon izni verilmedi. Sesli sohbet olmayacak ama oyuna katılabilirsin.");

        // Mikrofon olmasa bile oyuna katıl
        currentRoomId = roomId;
        socket.emit('join-room', {
            roomId,
            username: nickname,
            avatar: document.getElementById('avatar-img').src
        });

        document.getElementById('lobby').classList.remove('active');
        document.getElementById('game-room').classList.add('active');
        document.getElementById('room-name-label').innerText = roomId;
    }
};

// Hazır odaları listele
socket.on('room-list', (rooms) => {
    const container = document.getElementById('public-rooms');
    container.innerHTML = '';
    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = `room-card-item ${room.count >= room.max ? 'full' : ''}`;
        div.innerHTML = `<b>${room.id}</b><br><small>${room.count}/${room.max}</small>`;
        if (room.count < room.max) {
            div.onclick = () => window.joinRoom(room.id);
        }
        container.appendChild(div);
    });
});

// Oyuncu grid güncelle
socket.on('update-room-players', (data) => {
    const grid = document.getElementById('player-grid');
    grid.innerHTML = '';
    document.getElementById('admin-panel').style.display = (data.adminId === socket.id) ? 'block' : 'none';
    document.getElementById('player-status').innerText = `${data.players.length} Kişi`;

    data.players.forEach(player => {
        const card = document.createElement('div');
        card.className = `player-unit ${player.isAdmin ? 'is-admin' : ''} ${!player.isAlive ? 'dead-player' : ''}`;
        card.innerHTML = `
            <div class="avatar-wrap"><img src="${player.avatar}" alt="${player.username}"></div>
            <div class="p-name">${player.username} ${player.isAdmin ? '👑' : ''} ${!player.isAlive ? '💀' : ''}</div>
        `;
        grid.appendChild(card);
    });
});

// Faz ve zamanlayıcı
socket.on('phase-update', ({phase, timeLeft}) => {
    document.getElementById('phase-label').innerText = phase === 'night' ? '🌙 Gece' : '☀️ Gündüz';
    document.getElementById('timer-label').innerText = formatTime(timeLeft);

    document.getElementById('night-phase-overlay').classList.toggle('active', phase === 'night');
    document.getElementById('day-phase-overlay').classList.toggle('active', phase === 'day');

    playSFX(phase === 'night' ? 'sfx-night' : 'sfx-day');
});

function formatTime(seconds) {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
}

// Rol bildirimi
socket.on('role-assigned', (role) => {
    myRole = role;
    alert(`ROLÜN: ${role.toUpperCase()}`);
});

// Gece hedef seçimi (sadece vampire)
socket.on('night-action-required', ({targets}) => {
    const container = document.getElementById('night-targets');
    container.innerHTML = '<p>Hedef seç:</p>';
    targets.forEach(t => {
        if (t.id !== socket.id && t.isAlive) {
            const btn = document.createElement('div');
            btn.className = 'target-btn';
            btn.innerText = t.username;
            btn.onclick = () => {
                socket.emit('night-action', { targetId: t.id });
                container.querySelectorAll('.target-btn').forEach(b => b.style.borderColor = '');
                btn.style.borderColor = 'var(--gold)';
            };
            container.appendChild(btn);
        }
    });
});

// Gündüz oy verme
socket.on('vote-phase', ({targets}) => {
    const container = document.getElementById('vote-targets');
    container.innerHTML = '<p>Linç için oy ver:</p>';
    targets.forEach(t => {
        if (t.isAlive) {
            const btn = document.createElement('div');
            btn.className = 'target-btn';
            btn.innerText = t.username;
            btn.onclick = () => {
                socket.emit('vote', { targetId: t.id });
                container.querySelectorAll('.target-btn').forEach(b => b.style.borderColor = '');
                btn.style.borderColor = 'var(--gold)';
            };
            container.appendChild(btn);
        }
    });
});

socket.on('vote-result', ({message}) => {
    document.getElementById('vote-results').innerHTML = `<b>${message}</b>`;
    playSFX('sfx-vote');
});

// Oyun bitti
socket.on('game-over', ({winner, message}) => {
    document.getElementById('game-over-overlay').classList.add('active');
    document.getElementById('game-over-title').innerText = winner === 'village' ? '☀️ KÖYLÜLER KAZANDI!' : '🧛 VAMPİRLER KAZANDI!';
    document.getElementById('game-over-text').innerText = message;
    playSFX(winner === 'village' ? 'sfx-win-village' : 'sfx-win-vampire');
});

// WebRTC - Ses bağlantıları (trickle true ile hızlı)
socket.on('all-players', (users) => {
    users.forEach(user => {
        if (!peers[user.id] && user.id !== socket.id) {
            const peer = new SimplePeer({
                initiator: true,
                trickle: true,
                stream: localStream
            });

            peer.on('signal', signal => {
                socket.emit('sending-signal', { userToSignal: user.id, callerID: socket.id, signal });
            });

            peer.on('stream', stream => handleStream(user.id, stream));

            peer.on('error', err => console.error('Peer hatası:', err));

            peers[user.id] = peer;
        }
    });
});

socket.on('user-joined-signal', (payload) => {
    if (!peers[payload.callerID]) {
        const peer = new SimplePeer({
            initiator: false,
            trickle: true,
            stream: localStream
        });

        peer.on('signal', signal => {
            socket.emit('returning-signal', { signal, callerID: payload.callerID });
        });

        peer.on('stream', stream => handleStream(payload.callerID, stream));

        peer.on('error', err => console.error('Peer hatası:', err));

        peer.signal(payload.signal);
        peers[payload.callerID] = peer;
    }
});

socket.on('receiving-returned-signal', (payload) => {
    const peer = peers[payload.id];
    if (peer) peer.signal(payload.signal);
});

function handleStream(userId, stream) {
    let audio = document.getElementById(`audio-${userId}`);
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${userId}`;
        document.body.appendChild(audio);
    }
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.play().catch(e => console.log("Otomatik çalma engellendi:", e));
}

// Mikrofon aç/kapa
window.toggleMic = () => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        const btn = document.getElementById('mic-btn');
        btn.innerHTML = track.enabled ? "🎤" : "🔇";
        btn.classList.toggle('off', !track.enabled);
    }
};

// Hoparlör (tüm sesleri) aç/kapa
window.toggleSpk = () => {
    const audios = document.querySelectorAll('audio');
    const currentlyMuted = audios.length > 0 && audios[0].muted;
    audios.forEach(a => a.muted = !currentlyMuted);
    document.getElementById('spk-btn').classList.toggle('off', !currentlyMuted);
};

// Chat gönderme
window.sendChat = () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (text) {
        socket.emit('send-message', text);
        input.value = '';
    }
};

socket.on('new-message', ({user, text}) => {
    const messages = document.getElementById('chat-messages');
    messages.innerHTML += `<div><b>${user}:</b> ${text}</div>`;
    messages.scrollTop = messages.scrollHeight;
});

// Oyunu başlat (admin)
window.startGame = () => {
    socket.emit('start-game', currentRoomId);
};

// Hata mesajları
socket.on('error-msg', (msg) => {
    alert(msg);
});

// Bağlantı durumları
socket.on('connect', () => {
    console.log('Socket bağlandı:', socket.id);
});

socket.on('disconnect', () => {
    console.log('Socket bağlantısı kesildi');
    alert("Bağlantı koptu! Sayfayı yenileyin.");
});
