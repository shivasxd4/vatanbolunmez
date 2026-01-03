const socket = io();
let localStream;
const peers = {};
let myRoomId = null;
let myNickname = "Oyuncu";

async function initMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) { alert("Mikrofon izni veriniz!"); }
}

window.nextAvatar = () => {
    const s = Math.floor(Math.random()*1000);
    document.getElementById('avatar-img').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${s}`;
};

window.showCreateModal = () => document.getElementById('create-modal').style.display='flex';
window.closeModal = () => document.getElementById('create-modal').style.display='none';

window.confirmCreateRoom = () => {
    const id = document.getElementById('custom-room-id').value || Math.random().toString(36).substr(7);
    joinRoom(id);
};

window.joinByCode = () => {
    const id = document.getElementById('join-room-code').value;
    if(id) joinRoom(id);
};

async function joinRoom(roomId) {
    await initMedia();
    myRoomId = roomId;
    myNickname = document.getElementById('nickname').value || "Anonim";
    const avatar = document.getElementById('avatar-img').src;
    document.getElementById('lobby').classList.remove('active');
    document.getElementById('game-room').classList.add('active');
    socket.emit('join-room', { roomId, nickname: myNickname, avatar });
}

socket.on('all-users', users => {
    users.forEach(u => {
        const p = createPeer(u.id, socket.id, localStream);
        peers[u.id] = p;
    });
});

socket.on('user-joined', p => {
    const peer = addPeer(p.signal, p.callerID, localStream);
    peers[p.callerID] = peer;
});

socket.on('receiving-returned-signal', p => {
    peers[p.id].signal(p.signal);
});

function createPeer(userToSignal, callerID, stream) {
    const p = new SimplePeer({
        initiator: true, trickle: false,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
        stream
    });
    p.on('signal', signal => socket.emit('sending-signal', { userToSignal, callerID, signal }));
    p.on('stream', st => playAudio(st, userToSignal));
    return p;
}

function addPeer(incomingSignal, callerID, stream) {
    const p = new SimplePeer({ initiator: false, trickle: false, stream });
    p.on('signal', signal => socket.emit('returning-signal', { signal, callerID }));
    p.on('stream', st => playAudio(st, callerID));
    p.signal(incomingSignal);
    return p;
}

function playAudio(stream, id) {
    let a = document.getElementById("aud-"+id);
    if(!a) {
        a = document.createElement('audio');
        a.id = "aud-"+id; a.autoplay = true;
        document.body.appendChild(a);
    }
    a.srcObject = stream;
}

socket.on('room-update', users => {
    const grid = document.getElementById('player-grid');
    grid.innerHTML = users.map(u => `
        <div class="player-unit">
            <img src="${u.avatar}" width="60" style="border-radius:50%">
            <p>${u.nickname}</p>
        </div>
    `).join('');
});

window.sendChat = () => {
    const i = document.getElementById('chat-input');
    if(!i.value) return;
    socket.emit('send-chat', { roomId: myRoomId, nickname: myNickname, message: i.value });
    i.value = "";
};

socket.on('receive-chat', d => {
    const m = document.getElementById('chat-messages');
    m.innerHTML += `<p><b>${d.sender}:</b> ${d.message}</p>`;
    m.scrollTop = m.scrollHeight;
});

window.toggleMic = () => {
    const t = localStream.getAudioTracks()[0];
    t.enabled = !t.enabled;
    document.getElementById('mic-btn').innerText = t.enabled ? "🎤" : "🔇";
};
