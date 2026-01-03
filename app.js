const socket = io();

// --- DEĞİŞKENLER ---
let localStream;
let currentFacing = "user";
let pcs = {};
let activeEffect = "none";
let faceInterval;
const isAdmin = window.location.search.includes('12345678');

// --- 1. FACE-API MODELLERİNİ YÜKLE (VLADMANDIC) ---
async function loadModels() {
    const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
    try {
        // Efektlerin çalışması için bu iki model şart
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        console.log("VK: Face-API Modelleri Başarıyla Yüklendi.");
    } catch (err) {
        console.error("Model yükleme hatası:", err);
    }
}
loadModels();

// --- 2. MEDYA BAŞLATMA ---
async function startMedia() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacing, width: 640, height: 480 },
            audio: true
        });

        const video = document.getElementById('my-video');
        video.srcObject = localStream;

        // Kamera Aynalama Fix
        if (currentFacing === "user") {
            video.classList.add('mirror');
        } else {
            video.classList.remove('mirror');
        }

        if (isAdmin) document.getElementById('admin-panel').style.display = 'flex';
        
        // Eğer bir efekt seçiliyse takibi başlat
        if (activeEffect !== 'none') startFaceTracking();

        return localStream;
    } catch (err) {
        console.error("Medya hatası:", err);
    }
}

// --- 3. BIYIK VE YÜZ TAKİP MOTORU ---
async function startFaceTracking() {
    const video = document.getElementById('my-video');
    const canvas = document.getElementById('face-canvas');
    const ctx = canvas.getContext('2d');

    if (faceInterval) clearInterval(faceInterval);

    faceInterval = setInterval(async () => {
        if (activeEffect === 'none' || video.paused || video.ended) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        // Yüzü algıla
        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
            .withFaceLandmarks();

        if (detection) {
            // Canvas boyutlarını videoya eşitle
            const dims = faceapi.matchDimensions(canvas, video, true);
            const resized = faceapi.resizeResults(detection, dims);
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // AYNALAMA FİX: Eğer ön kamera ise canvas'ı da ters çevir ki bıyık ters gitmesin
            if (currentFacing === "user") {
                ctx.save();
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
            }

            const landmarks = resized.landmarks;
            const nose = landmarks.getNose(); // Burun noktaları
            const mouth = landmarks.getMouth(); // Ağız noktaları

            if (activeEffect === 'mustache') {
                // Bıyığı burun altı ve üst dudak arasına tam oturt
                const mustacheImg = new Image();
                mustacheImg.src = "https://png.pngtree.com/png-clipart/20240814/original/pngtree-hercule-poirot-fake-moustache-isolated-png-image_15771523.png";
                
                // Bıyık merkezi: Burnun alt noktası (Nose[6]) ile üst dudağın ortası (Mouth[14])
                const x = nose[6].x;
                const y = (nose[6].y + mouth[14].y) / 2;
                const width = resized.detection.box.width * 0.7; // Yüz genişliğine göre bıyık boyutu
                const height = width * 0.4;

                ctx.drawImage(mustacheImg, x - (width / 2), y - (height / 2), width, height);
            } 
            else if (activeEffect === 'makeup') {
                // Basit Allık Efekti
                ctx.fillStyle = "rgba(255, 0, 100, 0.2)";
                const leftEye = landmarks.getLeftEye();
                const rightEye = landmarks.getRightEye();
                ctx.beginPath();
                ctx.arc(leftEye[0].x, leftEye[0].y + 25, 20, 0, 2 * Math.PI);
                ctx.arc(rightEye[3].x, rightEye[3].y + 25, 20, 0, 2 * Math.PI);
                ctx.fill();
            }

            if (currentFacing === "user") ctx.restore();
        }
    }, 50); // 20 FPS takip hızı
}

// --- 4. UI VE EFEKT TETİKLEYİCİ ---
window.setEffect = (type, el) => {
    activeEffect = type;
    document.querySelectorAll('.fx-card').forEach(card => card.classList.remove('active-fx'));
    if(el) el.classList.add('active-fx');
    
    if (window.navigator.vibrate) window.navigator.vibrate(20);
    
    if (activeEffect !== 'none') {
        startFaceTracking();
    } else {
        const canvas = document.getElementById('face-canvas');
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
};

// --- 5. ADMIN FAKE VIDEO (MP4) SİSTEMİ ---
window.playFakeVideo = async (videoSrc) => {
    const fakeVideo = document.getElementById('fake-video');
    fakeVideo.src = videoSrc;
    fakeVideo.style.display = 'block';
    await fakeVideo.play();
    
    const videoStream = fakeVideo.captureStream();
    document.getElementById('my-video').srcObject = videoStream;

    Object.values(pcs).forEach(peer => {
        const vSender = peer.getSenders().find(s => s.track.kind === 'video');
        if (vSender) vSender.replaceTrack(videoStream.getVideoTracks()[0]);
        
        const aSender = peer.getSenders().find(s => s.track.kind === 'audio');
        if (aSender) aSender.replaceTrack(videoStream.getAudioTracks()[0]);
    });
};

window.stopFakeVideo = async () => {
    const stream = await startMedia();
    Object.values(pcs).forEach(peer => {
        const vSender = peer.getSenders().find(s => s.track.kind === 'video');
        const aSender = peer.getSenders().find(s => s.track.kind === 'audio');
        vSender.replaceTrack(stream.getVideoTracks()[0]);
        aSender.replaceTrack(stream.getAudioTracks()[0]);
    });
    document.getElementById('fake-video').pause();
};

// --- 6. WebRTC VE SOCKET ---
window.startCall = async (type, limit = 2) => {
    await startMedia();
    const nick = document.getElementById('nickname').value || "User";
    const room = document.getElementById('room-code').value;
    
    socket.emit(type === 'random' ? 'join-random' : 'join-private', { 
        roomId: room, 
        limit: limit,
        userData: { nickname: nick, isAdmin } 
    });
    
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').classList.add('active');
};

function createPeer(id, initiator) {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcs[id] = peer;

    localStream.getTracks().forEach(t => peer.addTrack(t, localStream));

    peer.onicecandidate = e => e.candidate && socket.emit('signal', { to: id, signal: e.candidate });
    
    peer.ontrack = e => {
        let rv = document.getElementById(`v-${id}`);
        if (!rv) {
            rv = document.createElement('video');
            rv.id = `v-${id}`; rv.autoplay = true; rv.playsinline = true; rv.className = "remote-video";
            document.getElementById('remote-container').appendChild(rv);
        }
        rv.srcObject = e.streams[0];
    };

    if (initiator) {
        peer.createOffer().then(o => { peer.setLocalDescription(o); socket.emit('signal', { to: id, signal: o }); });
    }
    return peer;
}

socket.on('start-call', d => createPeer(d.targetId, d.initiator));
socket.on('signal', async d => {
    let p = pcs[d.from] || createPeer(d.from, false);
    if (d.signal.type === 'offer') {
        await p.setRemoteDescription(d.signal);
        const a = await p.createAnswer(); await p.setLocalDescription(a);
        socket.emit('signal', { to: d.from, signal: a });
    } else if (d.signal.type === 'answer') await p.setRemoteDescription(d.signal);
    else if (d.signal.candidate) await p.addIceCandidate(d.signal);
});

window.toggleMic = () => {
    const t = localStream.getAudioTracks()[0];
    t.enabled = !t.enabled;
    document.getElementById('mic-btn').innerHTML = t.enabled ? "🎤" : "🔇";
};

window.switchCamera = async () => {
    currentFacing = currentFacing === "user" ? "environment" : "user";
    await startMedia();
};

