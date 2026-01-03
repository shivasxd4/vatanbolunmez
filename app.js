const socket = io();
let localStream;
const peers = {};

// WebRTC için Google STUN Sunucuları (Uluslararası bağlantı için)
const iceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

async function initMedia() {
    if (localStream) return;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
        alert("Mikrofon izni gerekli! Lütfen ayarlardan izin verin.");
    }
}

// Modal Yönetimi
window.showCreateModal = () => document.getElementById('create-modal').style.display = 'flex';
window.closeModal = () => document.getElementById('create-modal').style.display = 'none';

window.confirmCreateRoom = () => {
    const id = document.getElementById('custom-room-id').value || Math.random().toString(36).substr(7);
    joinRoom(id);
};

async function joinRoom(roomId) {
    await initMedia();
    const nickname = document.getElementById('nickname').value || "Oyuncu";
    const avatar = document.getElementById('avatar-img').src;
    
    document.getElementById('lobby').classList.remove('active');
    document.getElementById('game-room').classList.add('active');
    window.myRoomId = roomId;
    window.myNickname = nickname;

    socket.emit('join-room', { roomId, nickname, avatar });
}

// WebRTC Bağlantı Mantığı
socket.on('all-users', users => {
    users.forEach(u => {
        const p = new SimplePeer({
            initiator: true,
            trickle: false,
            config: iceConfig,
            stream: localStream
        });
        p.on('signal', signal => socket.emit('sending-signal', { userToSignal: u.id, callerID: socket.id, signal }));
        p.on('stream', st => playAudio(st, u.id));
        peers[u.id] = p;
    });
});

socket.on('user-joined', p => {
    const peer = new SimplePeer({
        initiator: false,
        trickle: false,
        config: iceConfig,
        stream: localStream
    });
    peer.on('signal', signal => socket.emit('returning-signal', { signal, callerID: p.callerID }));
    peer.on('stream', st => playAudio(st, p.callerID));
    peer.signal(p.signal);
    peers[p.callerID] = peer;
});

socket.on('receiving-returned-signal', p => {
    peers[p.id].signal(p.signal);
});

function playAudio(stream, id) {
    let a = document.getElementById("aud-"+id) || document.createElement('audio');
    a.id = "aud-"+id; a.autoplay = true; a.srcObject = stream;
    document.body.appendChild(a);
}

// Mesajlaşma
window.sendChat = () => {
    const i = document.getElementById('chat-input');
    if(!i.value) return;
    socket.emit('send-chat', { roomId: window.myRoomId, nickname: window.myNickname, message: i.value });
    i.value = "";
};

socket.on('receive-chat', d => {
    const m = document.getElementById('chat-messages');
    m.innerHTML += `<div><b>${d.sender}:</b> ${d.message}</div>`;
    m.scrollTop = m.scrollHeight;
});
