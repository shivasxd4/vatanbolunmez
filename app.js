const socket = io();
let localStream, myRoomId, currentMode;
let facingMode = "user"; // "user" ön, "environment" arka
let pcs = {}; 
let audioCtx, currentFx = 'normal';

// --- KAR EFEKTİ ---
setInterval(() => {
    const s = document.createElement('div');
    s.className = 'snowflake'; s.innerText = '❄';
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = (Math.random() * 3 + 2) + 's';
    document.getElementById('snow').appendChild(s);
    setTimeout(() => s.remove(), 5000);
}, 500);

// --- KAMERA YÖNETİMİ ---
async function startMedia() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    localStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: facingMode }, 
        audio: true 
    });
    document.getElementById('my-video').srcObject = localStream;
    return localStream;
}

window.flipCamera = async () => {
    facingMode = (facingMode === "user") ? "environment" : "user";
    await startMedia();
    // Mevcut görüşmedeki stream'i güncelle
    Object.values(pcs).forEach(pc => {
        const videoTrack = localStream.getVideoTracks()[0];
        const sender = pc.getSenders().find(s => s.track.kind === 'video');
        sender.replaceTrack(videoTrack);
    });
};

// --- EŞLEŞME BAŞLAT ---
window.startRandom = async () => {
    await startMedia();
    currentMode = 'random';
    const nickname = document.getElementById('nickname').value || "Anonim";
    socket.emit('join-random', { nickname, avatar: document.getElementById('avatar-img').src });
    showRoom();
};

window.startPrivate = async (limit) => {
    const code = document.getElementById('room-code').value;
    if(!code) return alert("Kod gir kanka!");
    await startMedia();
    currentMode = 'private';
    myRoomId = code;
    socket.emit('join-private', { roomId: code, limit, userData: { nickname: document.getElementById('nickname').value || "Gizemli" } });
    showRoom();
};

function showRoom() {
    document.getElementById('lobby').classList.remove('active');
    document.getElementById('game-room').classList.add('active');
}

// --- WEB RTC ---
socket.on('matched', (data) => {
    myRoomId = data.roomId;
    initPeer(data.partnerId, data.initiator);
});

socket.on('private-joined', (data) => {
    data.otherUsers.forEach(id => initPeer(id, true));
});

socket.on('user-connected', (data) => {
    initPeer(data.id, false);
});

function initPeer(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcs[id] = pc;

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.onicecandidate = e => e.candidate && socket.emit('signal', { to: id, signal: e.candidate });
    pc.ontrack = e => addRemoteVideo(id, e.streams[0]);

    if (initiator) {
        pc.createOffer().then(o => {
            pc.setLocalDescription(o);
            socket.emit('signal', { to: id, signal: o });
        });
    }

    socket.on('signal', async d => {
        if (d.from !== id) return;
        if (d.signal.type === 'offer') {
            await pc.setRemoteDescription(d.signal);
            const a = await pc.createAnswer();
            await pc.setLocalDescription(a);
            socket.emit('signal', { to: id, signal: a });
        } else if (d.signal.type === 'answer') {
            await pc.setRemoteDescription(d.signal);
        } else if (d.signal.candidate) {
            await pc.addIceCandidate(d.signal);
        }
    });
}

function addRemoteVideo(id, stream) {
    if (document.getElementById(`vid-${id}`)) return;
    const grid = document.getElementById('video-grid');
    grid.classList.add('multi');
    
    const box = document.createElement('div');
    box.className = 'video-box';
    box.id = `vid-${id}`;
    box.onclick = () => box.classList.toggle('expanded'); // BÜYÜTME ÖZELLİĞİ

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsinline = true;
    video.srcObject = stream;
    
    box.appendChild(video);
    grid.appendChild(box);
}

// --- SONLANDIRMA ---
window.endCall = () => {
    location.reload(); // En güvenli yol ana menüye atmak için
};

socket.on('user-disconnected', id => {
    if(document.getElementById(`vid-${id}`)) document.getElementById(`vid-${id}`).remove();
    if(currentMode === 'random') endCall(); // Omegle tarzı birisi çıkınca bitir
});

// --- CHAT ---
window.sendChat = () => {
    const i = document.getElementById('chat-input');
    socket.emit('send-chat', { roomId: myRoomId, msg: i.value, from: "Ben" });
    i.value = "";
};

socket.on('receive-chat', d => {
    const box = document.getElementById('chat-msgs');
    box.innerHTML += `<div><b>${d.from}:</b> ${d.msg}</div>`;
    box.scrollTop = box.scrollHeight;
});
