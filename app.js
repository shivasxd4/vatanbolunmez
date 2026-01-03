const socket = io();
let localStream;
const peers = {}; // Bağlantıları saklar
let myRoomId = null;
let myNickname = "İsimsiz";

// Başlangıçta Mikrofon İzni Al
async function getMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        console.log("Mikrofon aktif.");
    } catch (err) {
        console.error("Mikrofon hatası:", err);
        alert("Sesli sohbet için mikrofon izni şart!");
    }
}

// Avatar Değiştirme (Basit Rastgelelik)
window.nextAvatar = function() {
    const seed = Math.floor(Math.random() * 1000);
    document.getElementById('avatar-img').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
}

// Odaya Katılma Fonksiyonları
window.showCreateModal = () => document.getElementById('create-modal').style.display = 'flex';
window.closeModal = () => document.getElementById('create-modal').style.display = 'none';

window.confirmCreateRoom = () => {
    const rId = document.getElementById('custom-room-id').value || Math.random().toString(36).substring(7);
    joinRoom(rId);
};

window.joinByCode = () => {
    const rId = document.getElementById('join-room-code').value;
    if(rId) joinRoom(rId);
};

async function joinRoom(roomId) {
    if (!localStream) await getMedia();
    
    myRoomId = roomId;
    myNickname = document.getElementById('nickname').value || "Vampir";
    const avatar = document.getElementById('avatar-img').src;

    document.getElementById('lobby').classList.remove('active');
    document.getElementById('game-room').classList.add('active');
    document.getElementById('room-name-label').innerText = `ODA: ${roomId}`;

    socket.emit('join-room', { roomId, nickname: myNickname, avatar });
}

// WebRTC - Peer-to-Peer Bağlantı Kurulumu
socket.on('all-users', users => {
    users.forEach(user => {
        const peer = createPeer(user.id, socket.id, localStream);
        peers[user.id] = peer;
    });
});

socket.on('user-joined', payload => {
    const peer = addPeer(payload.signal, payload.callerID, localStream);
    peers[payload.callerID] = peer;
});

socket.on('receiving-returned-signal', payload => {
    peers[payload.id].signal(payload.signal);
});

function createPeer(userToSignal, callerID, stream) {
    const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
        stream
    });

    peer.on('signal', signal => {
        socket.emit('sending-signal', { userToSignal, callerID, signal });
    });

    peer.on('stream', stream => handleRemoteStream(stream, userToSignal));
    return peer;
}

function addPeer(incomingSignal, callerID, stream) {
    const peer = new SimplePeer({
        initiator: false,
        trickle: false,
        stream
    });

    peer.on('signal', signal => {
        socket.emit('returning-signal', { signal, callerID });
    });

    peer.on('stream', stream => handleRemoteStream(stream, callerID));
    peer.signal(incomingSignal);
    return peer;
}

function handleRemoteStream(stream, userId) {
    let audio = document.getElementById(`audio-${userId}`);
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${userId}`;
        audio.autoplay = true;
        document.body.appendChild(audio);
    }
    audio.srcObject = stream;
}

// Odadaki Oyuncuları Listeleme (Arayüz)
socket.on('room-update', users => {
    const grid = document.getElementById('player-grid');
    grid.innerHTML = "";
    users.forEach(user => {
        grid.innerHTML += `
            <div class="player-unit">
                <img src="${user.avatar}" width="50">
                <div style="font-size:12px; margin-top:5px;">${user.nickname}</div>
                ${user.id === socket.id ? '<small>(Sen)</small>' : ''}
            </div>
        `;
    });
});

// Chat İşlemleri
window.sendChat = () => {
    const input = document.getElementById('chat-input');
    if (!input.value.trim()) return;

    socket.emit('send-chat', {
        roomId: myRoomId,
        nickname: myNickname,
        message: input.value
    });
    input.value = "";
};

socket.on('receive-chat', data => {
    const msgDiv = document.getElementById('chat-messages');
    msgDiv.innerHTML += `<div><span style="color:var(--accent)">${data.sender}:</span> ${data.message}</div>`;
    msgDiv.scrollTop = msgDiv.scrollHeight;
});

// Mikrofon Kapat/Aç
window.toggleMic = () => {
    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    const btn = document.getElementById('mic-btn');
    btn.innerText = track.enabled ? "🎤" : "🔇";
    btn.style.background = track.enabled ? "var(--card)" : "var(--error)";
};
