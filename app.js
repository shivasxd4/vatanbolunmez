const socket = io();

// --- DEĞİŞKENLER ---
let localStream, pc;
let currentFacing = "user";
let pcs = {};
// URL'de ?12345678 varsa admin yetkisi ver
const isAdmin = window.location.search.includes('12345678');

// --- 1. VLADMANDIC FACE-API MODELLERİ ---
async function loadFaceModels() {
    // Vladmandic versiyonu için CDN üzerinden modeller
    const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        console.log("VK: Face-API Modelleri Yüklendi.");
    } catch (err) {
        console.error("Model yükleme hatası:", err);
    }
}
loadFaceModels();

// --- 2. MEDYA BAŞLATMA ---
async function startMedia() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    try {
        // Normal kamera ve mikrofonu al
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacing, width: 640 },
            audio: true
        });

        const myVideo = document.getElementById('my-video');
        myVideo.srcObject = localStream;

        // Admin ise kontrol panelini göster
        if (isAdmin) {
            document.getElementById('admin-panel').style.display = 'flex';
        }

        return localStream;
    } catch (err) {
        console.error("Kamera başlatılamadı:", err);
    }
}

// --- 3. ADMIN FAKE VIDEO (MP4) SİSTEMİ ---
window.playFakeVideo = async (videoSrc) => {
    const fakeVideo = document.getElementById('fake-video');
    const myVideoDisplay = document.getElementById('my-video');
    
    fakeVideo.src = videoSrc;
    fakeVideo.muted = false; // Karşı taraf sesi duysun
    await fakeVideo.play();
    
    // Videodan stream yakala
    const videoStream = fakeVideo.captureStream ? fakeVideo.captureStream() : fakeVideo.mozCaptureStream();
    
    const newVideoTrack = videoStream.getVideoTracks()[0];
    const newAudioTrack = videoStream.getAudioTracks()[0];

    // Kendi görüntümüzde de videoyu izleyelim
    myVideoDisplay.srcObject = videoStream;

    // Bağlı olan tüm kullanıcılara kameramız yerine videoyu gönder
    Object.values(pcs).forEach(peer => {
        const senders = peer.getSenders();
        
        // Görüntü track'ini değiştir
        const vSender = senders.find(s => s.track && s.track.kind === 'video');
        if (vSender) vSender.replaceTrack(newVideoTrack);
        
        // Ses track'ini değiştir (MP4'ün sesi gitsin)
        const aSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (aSender && newAudioTrack) aSender.replaceTrack(newAudioTrack);
    });

    console.log(`Admin: ${videoSrc} oynatılıyor...`);
};

// Fake videoyu durdurup gerçek kameraya dönme
window.stopFakeVideo = async () => {
    const stream = await startMedia();
    const vTrack = stream.getVideoTracks()[0];
    const aTrack = stream.getAudioTracks()[0];

    Object.values(pcs).forEach(peer => {
        const senders = peer.getSenders();
        const vSender = senders.find(s => s.track && s.track.kind === 'video');
        const aSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (vSender) vSender.replaceTrack(vTrack);
        if (aSender) aSender.replaceTrack(aTrack);
    });
    
    document.getElementById('fake-video').pause();
    console.log("Admin: Gerçek kameraya dönüldü.");
};

// --- 4. WebRTC SİNYALLEŞME ---
function createPeer(targetId, initiator) {
    const peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    pcs[targetId] = peer;

    // Mevcut stream'i (kamera veya admin videosu) ekle
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

    peer.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('signal', { to: targetId, signal: e.candidate });
        }
    };

    peer.ontrack = (e) => {
        let remoteVid = document.getElementById(`vid-${targetId}`);
        if (!remoteVid) {
            remoteVid = document.createElement('video');
            remoteVid.id = `vid-${targetId}`;
            remoteVid.autoplay = true;
            remoteVid.playsinline = true;
            remoteVid.className = "remote-video";
            document.getElementById('remote-container').appendChild(remoteVid);
        }
        remoteVid.srcObject = e.streams[0];
    };

    if (initiator) {
        peer.createOffer().then(offer => {
            peer.setLocalDescription(offer);
            socket.emit('signal', { to: targetId, signal: offer });
        });
    }
    return peer;
}

// --- 5. SOCKET OLAYLARI ---
socket.on('start-call', data => createPeer(data.targetId, data.initiator));
socket.on('existing-users', users => users.forEach(id => createPeer(id, true)));
socket.on('user-joined-room', data => createPeer(data.id, false));

socket.on('signal', async data => {
    let peer = pcs[data.from] || createPeer(data.from, false);

    if (data.signal.type === 'offer') {
        await peer.setRemoteDescription(new RTCSessionDescription(data.signal));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('signal', { to: data.from, signal: answer });
    } else if (data.signal.type === 'answer') {
        await peer.setRemoteDescription(new RTCSessionDescription(data.signal));
    } else if (data.signal.candidate) {
        await peer.addIceCandidate(new RTCIceCandidate(data.signal));
    }
});

socket.on('user-left', id => {
    if (pcs[id]) {
        pcs[id].close();
        delete pcs[id];
    }
    const el = document.getElementById(`vid-${id}`);
    if (el) el.remove();
});

// --- 6. UI KONTROLLERİ ---
window.startCall = async (type, limit = 2) => {
    await startMedia();
    const nick = document.getElementById('nickname').value || "Vampir";
    
    const roomId = document.getElementById('room-code').value;
    if (type === 'random') {
        socket.emit('join-random', { nickname: nick, isAdmin });
    } else {
        socket.emit('join-private', { roomId, limit, userData: { nickname: nick, isAdmin } });
    }

    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').classList.add('active');
};

window.toggleMic = () => {
    const track = localStream.getAudioTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        document.getElementById('mic-btn').innerHTML = track.enabled ? "🎤" : "🔇";
    }
};

window.switchCamera = async () => {
    currentFacing = (currentFacing === "user") ? "environment" : "user";
    const stream = await startMedia();
    
    Object.values(pcs).forEach(peer => {
        const vSender = peer.getSenders().find(s => s.track.kind === 'video');
        if (vSender) vSender.replaceTrack(stream.getVideoTracks()[0]);
    });
};
