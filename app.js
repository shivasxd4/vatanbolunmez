const socket = io();
let localStream;
let myRoomId = "Global";
const pcs = {}; 

// --- KAR EFEKTİ ---
function createSnow() {
    const container = document.getElementById('snow-container');
    const snowflakes = ['❄', '❅', '❆'];
    setInterval(() => {
        const snow = document.createElement('div');
        snow.className = 'snowflake';
        snow.innerText = snowflakes[Math.floor(Math.random() * snowflakes.length)];
        snow.style.left = Math.random() * 100 + 'vw';
        snow.style.animationDuration = (Math.random() * 3 + 2) + 's';
        snow.style.opacity = Math.random();
        container.appendChild(snow);
        setTimeout(() => snow.remove(), 5000);
    }, 200);
}
createSnow();

// --- AVATAR VE GİRİŞ ---
document.getElementById('avatar-img').onclick = () => {
    document.getElementById('avatar-img').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${Math.random()}`;
};

document.getElementById('btn-join').onclick = async () => {
    try {
        // Görüntü ve Ses Al
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        document.getElementById('lobby').classList.remove('active');
        document.getElementById('game-room').classList.add('active');
        
        // Kendi videomuzu ekle
        addVideoGrid(socket.id, localStream, (document.getElementById('nickname').value || "Ben"), true);
        
        socket.emit('join-room', { 
            roomId: "RoyalRoom", 
            nickname: document.getElementById('nickname').value || "Oyuncu",
            avatar: document.getElementById('avatar-img').src 
        });
    } catch (e) { alert("Kamera ve Mikrofon izni gerekli!"); }
};

// --- WEB RTC MANTIĞI ---
socket.on('all-users', users => {
    users.forEach(userId => {
        const pc = createPC(userId);
        pc.createOffer().then(offer => {
            pc.setLocalDescription(offer);
            socket.emit('offer', { sdp: offer, userToSignal: userId, callerID: socket.id });
        });
    });
});

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
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcs[userId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = e => {
        if (e.candidate) socket.emit('ice-candidate', { target: userId, candidate: e.candidate });
    };

    pc.ontrack = e => {
        addVideoGrid(userId, e.streams[0], "Oyuncu");
    };
    return pc;
}

function addVideoGrid(id, stream, name, isMe = false) {
    if (document.getElementById(`vid-${id}`)) return;
    
    const div = document.createElement('div');
    div.id = `vid-${id}`;
    div.className = 'player-unit';
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsinline = true;
    video.srcObject = stream;
    if (isMe) video.muted = true;

    const info = document.createElement('div');
    info.className = 'player-info';
    info.innerText = name;

    div.appendChild(video);
    div.appendChild(info);
    document.getElementById('player-grid').appendChild(div);
}

// --- MEDYA KONTROLLERİ ---
document.getElementById('mic-btn').onclick = () => {
    const t = localStream.getAudioTracks()[0];
    t.enabled = !t.enabled;
    document.getElementById('mic-btn').innerText = t.enabled ? "🎤" : "🔇";
};

document.getElementById('cam-btn').onclick = () => {
    const t = localStream.getVideoTracks()[0];
    t.enabled = !t.enabled;
    document.getElementById('cam-btn').innerText = t.enabled ? "📹" : "❌";
};

// --- CHAT ---
document.getElementById('btn-send').onclick = () => {
    const i = document.getElementById('chat-input');
    if (!i.value) return;
    socket.emit('send-chat', { roomId: "RoyalRoom", nickname: (document.getElementById('nickname').value || "Oyuncu"), message: i.value });
    i.value = "";
};

socket.on('receive-chat', d => {
    const m = document.getElementById('chat-messages');
    m.innerHTML += `<div><b>${d.nickname}:</b> ${d.message}</div>`;
    m.scrollTop = m.scrollHeight;
});

socket.on('room-update', users => {
    // Çıkanları temizle
    const ids = users.map(u => `vid-${u.id}`);
    document.querySelectorAll('.player-unit').forEach(el => {
        if (el.id !== `vid-${socket.id}` && !ids.includes(el.id)) el.remove();
    });
});
