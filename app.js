const socket = io();
let localStream;
let myRoomId, myNickname;
const pcs = {}; // Peer Connections

const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// --- ELEMENTLER ---
const avatarImg = document.getElementById('avatar-img');
const btnCreateOpen = document.getElementById('btn-create-open');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnConfirmCreate = document.getElementById('btn-confirm-create');
const btnJoinAction = document.getElementById('btn-join-action');
const btnSendChat = document.getElementById('btn-send-chat');
const micBtn = document.getElementById('mic-btn');

// --- AVATAR DEĞİŞTİRME ---
avatarImg.onclick = () => {
    const seed = Math.floor(Math.random() * 10000);
    avatarImg.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
};

// --- MODAL YÖNETİMİ ---
btnCreateOpen.onclick = () => document.getElementById('create-modal').style.display = 'flex';
btnCloseModal.onclick = () => document.getElementById('create-modal').style.display = 'none';

// --- ODA KATILMA ---
btnConfirmCreate.onclick = () => {
    const id = document.getElementById('custom-room-id').value || Math.random().toString(36).substr(7);
    joinRoom(id);
};

btnJoinAction.onclick = () => {
    const id = document.getElementById('join-room-code').value;
    if (id) joinRoom(id);
};

async function joinRoom(roomId) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        myRoomId = roomId;
        myNickname = document.getElementById('nickname').value || "Oyuncu";
        
        document.getElementById('lobby').classList.remove('active');
        document.getElementById('game-room').classList.add('active');
        document.getElementById('room-name-label').innerText = "ODA: " + roomId;

        socket.emit('join-room', { roomId, nickname: myNickname, avatar: avatarImg.src });
    } catch (err) {
        alert("Mikrofon izni olmadan devam edilemez.");
    }
}

// --- SES İLETİŞİMİ (WEB RTC CORE) ---
socket.on('all-users', users => {
    users.forEach(userId => callUser(userId));
});

async function callUser(userId) {
    const pc = createPC(userId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { sdp: pc.localDescription, userToSignal: userId, callerID: socket.id });
}

socket.on('offer', async (data) => {
    const pc = createPC(data.callerID);
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { sdp: pc.localDescription, callerID: data.callerID });
});

socket.on('answer', data => {
    pcs[data.id].setRemoteDescription(new RTCSessionDescription(data.sdp));
});

socket.on('ice-candidate', data => {
    if (pcs[data.from]) pcs[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
});

function createPC(userId) {
    const pc = new RTCPeerConnection(iceConfig);
    pcs[userId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = e => {
        if (e.candidate) socket.emit('ice-candidate', { target: userId, candidate: e.candidate });
    };

    pc.ontrack = e => {
        let audio = document.getElementById("aud-" + userId);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = "aud-" + userId;
            audio.autoplay = true;
            document.body.appendChild(audio);
        }
        audio.srcObject = e.streams[0];
    };
    return pc;
}

// --- CHAT & UI ---
btnSendChat.onclick = sendChat;
function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input.value) return;
    socket.emit('send-chat', { roomId: myRoomId, nickname: myNickname, message: input.value });
    input.value = "";
}

socket.on('receive-chat', d => {
    const m = document.getElementById('chat-messages');
    m.innerHTML += `<div><b>${d.nickname}:</b> ${d.message}</div>`;
    m.scrollTop = m.scrollHeight;
});

socket.on('room-update', users => {
    const grid = document.getElementById('player-grid');
    grid.innerHTML = users.map(u => `
        <div class="player-unit">
            <img src="${u.avatar}" width="50" style="border-radius:50%">
            <p>${u.nickname}</p>
        </div>
    `).join('');
});

micBtn.onclick = () => {
    const t = localStream.getAudioTracks()[0];
    t.enabled = !t.enabled;
    micBtn.innerText = t.enabled ? "🎤" : "🔇";
    micBtn.style.background = t.enabled ? "" : "red";
};

document.getElementById('leave-btn').onclick = () => location.reload();
