// app.js - VK ROYALS | TAM TEŞEKKÜLLÜ, RAILWAY UYUMLU, TÜM CİHAZLARDA ÇALIŞAN VERSİYON
// Railway deploy için: socket.io otomatik origin alır → localhost ve https://*.up.railway.app'da sorunsuz çalışır

const socket = io(); // EN ÖNEMLİ DEĞİŞİKLİK: Boş bırakıldı → otomatik current domain'e bağlanır (HTTPS dahil)

let localStream = null;
let currentRoomId = null;
const peers = {};
let myRole = null;

// Ses efektleri çalma
function playSFX(id) {
    const audio = document.getElementById(id);
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {}); // Hata yut (autoplay policy)
    }
}

// AVATAR DEĞİŞTİR
window.nextAvatar = () => {
    const seed = Math.floor(Math.random() * 99999);
    document.getElementById('avatar-img').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
};

// MODAL KONTROLLERİ
window.showCreateModal = () => document.getElementById('create-modal').classList.add('active');
window.closeModal = () => document.getElementById('create-modal').classList.remove('active');

// YENİ ODA KUR
window.confirmCreateRoom = () => {
    let rId = document.getElementById('custom-room-id').value.trim();
    if (!rId) rId = "Oda-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    const maxP = document.getElementById('max-players-select').value;
    socket.emit('create-custom-room', { roomId: rId, max: maxP });
};

socket.on('room-created-success', (roomId) => {
    window.closeModal();
    window.joinRoom(roomId);
});

// ÖZEL ODA KODU İLE KATIL
window.joinByCode = () => {
    const roomId = document.getElementById('join-room-code').value.trim();
    if (!roomId) return alert("Oda kodunu giriniz!");
    window.joinRoom(roomId);
};

// ODAYA KATIL (ANA FONKSİYON)
window.joinRoom = async (roomId) => {
    const nick = document.getElementById('nickname').value.trim();
    if (!nick) return alert("Lütfen lakabınızı girin!");

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        currentRoomId = roomId;
        socket.emit('join-room', { 
            roomId, 
            username: nick, 
            avatar: document.getElementById('avatar-img').src 
        });

        // Ekran geçişi
        document.getElementById('lobby').classList.remove('active');
        document.getElementById('game-room').classList.add('active');
        document.getElementById('room-name-label').innerText = roomId;

        // Medya butonlarını sıfırla
        const micBtn = document.getElementById('mic-btn');
        const spkBtn = document.getElementById('spk-btn');
        micBtn.innerHTML = "🎤";
        micBtn.classList.remove('off');
        spkBtn.classList.remove('off');

    } catch (err) {
        console.error("Mikrofon erişim hatası:", err);
        alert("Mikrofon izni verilmedi! Sesli sohbet çalışmayacak.");
        // İzin verilmese bile oyuna devam et
        currentRoomId = roomId;
        socket.emit('join-room', { 
            roomId, 
            username: nick, 
            avatar: document.getElementById('avatar-img').src 
        });
        document.getElementById('lobby').classList.remove('active');
        document.getElementById('game-room').classList.add('active');
        document.getElementById('room-name-label').innerText = roomId;
    }
};

// HAZIR ODALARI LİSTELE
socket.on('room-list', (rooms) => {
    const container = document.getElementById('public-rooms');
    container.innerHTML = '';
    rooms.forEach(r => {
        const div = document.createElement('div');
        div.className = `room-card-item ${r.count >= r.max ? 'full' : ''}`;
        div.innerHTML = `<b>${r.id}</b><br><small>${r.count}/${r.max}</small>`;
        if (r.count < r.max) div.onclick = () => window.joinRoom(r.id);
        container.appendChild(div);
    });
});

// OYUNCU LİSTESİ GÜNCELLEME
socket.on('update-room-players', (data) => {
    const grid = document.getElementById('player-grid');
    grid.innerHTML = '';
    const isMeAdmin = data.adminId === socket.id;
    document.getElementById('admin-panel').style.display = isMeAdmin ? 'block' : 'none';
    document.getElementById('player-status').innerText = `${data.players.length} Kişi`;

    data.players.forEach(p => {
        const card = document.createElement('div');
        card.className = `player-unit ${p.isAdmin ? 'is-admin' : ''} ${!p.isAlive ? 'dead-player' : ''}`;
        card.innerHTML = `
            <div class="avatar-wrap"><img src="${p.avatar}" alt="avatar"></div>
            <div class="p-name">${p.username} ${p.isAdmin ? '👑' : ''} ${!p.isAlive ? '💀' : ''}</div>
        `;
        grid.appendChild(card);
    });
});

// FAZ VE ZAMANLAYICI
socket.on('phase-update', ({phase, timeLeft}) => {
    document.getElementById('phase-label').innerText = phase === 'night' ? '🌙 Gece' : '☀️ Gündüz';
    document.getElementById('timer-label').innerText = formatTime(timeLeft);

    document.getElementById('night-phase-overlay').classList.toggle('active', phase === 'night');
    document.getElementById('day-phase-overlay').classList.toggle('active', phase === 'day');

    if (phase === 'night') playSFX('sfx-night');
    else playSFX('sfx-day');
});

function formatTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
}

// ROL BİLDİRİMİ
socket.on('role-assigned', (role) => {
    myRole = role;
    alert(`ROLÜN: ${role.toUpperCase()}`);
});

// VAMPİR GECE HEDEF SEÇİMİ
socket.on('night-action-required', ({targets}) => {
    const container = document.getElementById('night-targets');
    container.innerHTML = '<p>Hedef seç:</p>';
    targets.forEach(t => {
        if (t.id !== socket.id && t.isAlive) {
            const btn = document.createElement('div');
            btn.className = 'target-btn';
            btn.innerText = t.username;
            btn.onclick = () => {
                socket.emit('night-action', {targetId: t.id});
                btn.style.borderColor = 'var(--gold)';
            };
            container.appendChild(btn);
        }
    });
});

// GÜNDÜZ OY VERME
socket.on('vote-phase', ({targets}) => {
    const container = document.getElementById('vote-targets');
    container.innerHTML = '<p>Linç için oy ver:</p>';
    targets.forEach(t => {
        if (t.isAlive) {
            const btn = document.createElement('div');
            btn.className = 'target-btn';
            btn.innerText = t.username;
            btn.onclick = () => {
                socket.emit('vote', {targetId: t.id});
                btn.style.borderColor = 'var(--gold)';
            };
            container.appendChild(btn);
        }
    });
});

socket.on('vote-result', ({message}) => {
    document.getElementById('vote-results').innerHTML = `<b>${message}</b>`;
});

// OYUN BİTTİ
socket.on('game-over', ({winner, message}) => {
    document.getElementById('game-over-overlay').classList.add('active');
    document.getElementById('game-over-title').innerText = winner === 'village' ? '☀️ KÖYLÜLER KAZANDI!' : '🧛 VAMPİRLER KAZANDI!';
    document.getElementById('game-over-text').innerText = message;
    playSFX(winner === 'village' ? 'sfx-win-village' : 'sfx-win-vampire');
});

// WEBRTC SES BAĞLANTISI (trickle true → hızlı bağlantı)
socket.on('all-players', (users) => {
    users.forEach(u => {
        if (!peers[u.id]) {
            const peer = new SimplePeer({ initiator: true, trickle: true, stream: localStream });
            peer.on('signal', signal => socket.emit('sending-signal', { userToSignal: u.id, callerID: socket.id, signal }));
            peer.on('stream', stream => handleStream(u.id, stream));
            peer.on('error', err => console.error('Peer error:', err));
            peers[u.id] = peer;
        }
    });
});

socket.on('user-joined-signal', (p) => {
    if (!peers[p.callerID]) {
        const peer = new SimplePeer({ initiator: false, trickle: true, stream: localStream });
        peer.on('signal', signal => socket.emit('returning-signal', { signal, callerID: p.callerID }));
        peer.on('stream', stream => handleStream(p.callerID, stream));
        peer.on('error', err => console.error('Peer error:', err));
        peer.signal(p.signal);
        peers[p.callerID] = peer;
    }
});

socket.on('receiving-returned-signal', (p) => {
    if (peers[p.id]) peers[p.id].signal(p.signal);
});

function handleStream(id, stream) {
    let audio = document.getElementById(`audio-${id}`);
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${id}`;
        document.body.appendChild(audio);
    }
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.play().catch(() => {});
}

// MİKROFON KONTROL
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

// HOPARLÖR (TÜM SESLERİ) KONTROL
window.toggleSpk = () => {
    const audios = document.querySelectorAll('audio');
    const isMuted = audios.length > 0 && audios[0].muted;
    audios.forEach(a => a.muted = !isMuted);
    document.getElementById('spk-btn').classList.toggle('off', !isMuted);
};

// CHAT
window.sendChat = () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (text) {
        socket.emit('send-message', text);
        input.value = '';
    }
};

socket.on('new-message', (d) => {
    const box = document.getElementById('chat-messages');
    box.innerHTML += `<div><b>${d.user}:</b> ${d.text}</div>`;
    box.scrollTop = box.scrollHeight;
});

// OYUN BAŞLAT (ADMIN)
window.startGame = () => socket.emit('start-game', currentRoomId);

// HATA MESAJLARI
socket.on('error-msg', (msg) => alert(msg));

// Bağlantı başarılıysa konsola yaz
socket.on('connect', () => {
    console.log('Socket.io bağlantısı kuruldu:', socket.id);
});

socket.on('disconnect', () => {
    console.log('Socket.io bağlantısı kesildi');
    alert("Bağlantı koptu! Sayfayı yenileyin.");
});
