// app.js - Ses gecikmesi düzeltildi (trickle: true), tuşlar kontrol edildi, özel oda katıl eklenildi
const socket = io("http://localhost:3000");
let localStream = null;
let currentRoomId = null;
const peers = {};
let myRole = null;

// Ses çalma fonksiyonu
function playSFX(id) {
    const audio = document.getElementById(id);
    if (audio) audio.play();
}

// AVATAR
window.nextAvatar = () => {
    const seed = Math.floor(Math.random() * 99999);
    document.getElementById('avatar-img').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
};

window.showCreateModal = () => document.getElementById('create-modal').classList.add('active');
window.closeModal = () => document.getElementById('create-modal').classList.remove('active');

// ODA İŞLEMLERİ
window.confirmCreateRoom = () => {
    let rId = document.getElementById('custom-room-id').value.trim();
    if (!rId) rId = "Oda-" + Math.random().toString(36).substr(2, 6);
    const maxP = document.getElementById('max-players-select').value;
    socket.emit('create-custom-room', { roomId: rId, max: maxP });
};

socket.on('room-created-success', (roomId) => {
    window.closeModal();
    window.joinRoom(roomId);
});

// Özel oda kod ile katıl
window.joinByCode = () => {
    const roomId = document.getElementById('join-room-code').value.trim();
    if (roomId) window.joinRoom(roomId);
};

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

        document.getElementById('lobby').classList.remove('active');
        document.getElementById('game-room').classList.add('active');
        document.getElementById('room-name-label').innerText = roomId;
        
        // Medya kontrollerini başlat
        document.getElementById('mic-btn').innerHTML = "🎤";
        document.getElementById('mic-btn').classList.remove('off');
        document.getElementById('spk-btn').classList.remove('off');
    } catch (e) {
        alert("Mikrofon izni verilmedi! Sesli sohbet çalışmayacak.");
    }
};

// ODA LİSTESİ
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

// OYUNCU GÜNCELLEME
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
            <div class="avatar-wrap"><img src="${p.avatar}"></div>
            <div class="p-name">${p.username} ${p.isAdmin ? '👑' : ''} ${!p.isAlive ? '💀' : ''}</div>
            <small>${p.role && !p.isAlive ? p.role.toUpperCase() : ''}</small>
        `;
        grid.appendChild(card);
    });
});

// FAZ VE TIMER
socket.on('phase-update', ({phase, timeLeft}) => {
    document.getElementById('phase-label').innerText = phase === 'night' ? '🌙 Gece' : '☀️ Gündüz';
    document.getElementById('timer-label').innerText = formatTime(timeLeft);

    document.getElementById('night-phase-overlay').classList.toggle('active', phase === 'night');
    document.getElementById('day-phase-overlay').classList.toggle('active', phase === 'day');

    if (phase === 'night') playSFX('sfx-night');
    else playSFX('sfx-day');
});

function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2,'0');
    const s = (sec % 60).toString().padStart(2,'0');
    return `${m}:${s}`;
}

socket.on('role-assigned', (role) => {
    myRole = role;
    alert(`ROLÜN: ${role.toUpperCase()}`);
});

// GECE EYLEMLERİ (Vampire hedef seçimi)
socket.on('night-action-required', ({targets}) => {
    const container = document.getElementById('night-targets');
    container.innerHTML = '<p>Hedef seç:</p>';
    targets.forEach(t => {
        if (t.id !== socket.id && t.isAlive) {
            const btn = document.createElement('div');
            btn.className = 'target-btn';
            btn.innerText = t.username;
            btn.onclick = () => socket.emit('night-action', {targetId: t.id});
            container.appendChild(btn);
        }
    });
});

// OY KULLANMA (Gündüz linç)
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

socket.on('vote-result', ({victim, message}) => {
    document.getElementById('vote-results').innerHTML = `<b>${message}</b>`;
    if (victim) playSFX('sfx-kill');
    else playSFX('sfx-vote');
});

// OYUN SONU
socket.on('game-over', ({winner, message}) => {
    document.getElementById('game-over-overlay').classList.add('active');
    document.getElementById('game-over-title').innerText = winner === 'village' ? '☀️ KÖYLÜLER KAZANDI!' : '🧛 VAMPİRLER KAZANDI!';
    document.getElementById('game-over-text').innerText = message;
    playSFX(winner === 'village' ? 'sfx-win-village' : 'sfx-win-vampire');
});

// WEBRTC SES (trickle: true ile gecikme azaltıldı)
socket.on('all-players', (users) => {
    users.forEach(u => {
        const peer = new SimplePeer({ initiator: true, trickle: true, stream: localStream });
        peer.on('signal', signal => socket.emit('sending-signal', { userToSignal: u.id, callerID: socket.id, signal }));
        peer.on('stream', stream => handleStream(u.id, stream));
        peers[u.id] = peer;
    });
});

socket.on('user-joined-signal', (p) => {
    const peer = new SimplePeer({ initiator: false, trickle: true, stream: localStream });
    peer.on('signal', signal => socket.emit('returning-signal', { signal, callerID: p.callerID }));
    peer.on('stream', stream => handleStream(p.callerID, stream));
    peer.signal(p.signal);
    peers[p.callerID] = peer;
});

socket.on('receiving-returned-signal', p => {
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
    audio.muted = false;  // Varsayılan muted false
}

// MEDYA KONTROLLERİ (hata korumalı, stream kontrolü)
window.toggleMic = () => {
    if (!localStream) return alert('Ses akışı yok!');
    const track = localStream.getAudioTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        document.getElementById('mic-btn').innerHTML = track.enabled ? "🎤" : "🔇";
        document.getElementById('mic-btn').classList.toggle('off', !track.enabled);
    }
};

window.toggleSpk = () => {
    const audios = document.querySelectorAll('audio');
    const muted = audios[0]?.muted;
    audios.forEach(a => a.muted = !muted);
    document.getElementById('spk-btn').classList.toggle('off');
};

// CHAT
window.sendChat = () => {
    const input = document.getElementById('chat-input');
    if(input.value.trim()) {
        socket.emit('send-message', input.value.trim());
        input.value = '';
    }
};

socket.on('new-message', d => {
    const box = document.getElementById('chat-messages');
    box.innerHTML += `<div><b>${d.user}:</b> ${d.text}</div>`;
    box.scrollTop = box.scrollHeight;
});

window.startGame = () => socket.emit('start-game', currentRoomId);
socket.on('error-msg', m => alert(m));