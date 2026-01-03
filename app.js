const socket = io();
let localStream, pc, currentFacing = "user", activeEffect = "none";
let pcs = {}, faceInterval;
const isAdmin = window.location.search.includes('12345678');

// Modelleri Yükle
async function loadModels() {
    const URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
    await faceapi.nets.tinyFaceDetector.loadFromUri(URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(URL);
    console.log("Modeller Hazır");
}
loadModels();

// Medya Başlat
async function startMedia() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing, width: 640 }, audio: true
    });
    const video = document.getElementById('my-video');
    video.srcObject = localStream;
    // Mirror (Aynalama) Kontrolü
    currentFacing === "user" ? video.classList.add('mirror') : video.classList.remove('mirror');
    if (isAdmin) document.getElementById('admin-panel').style.display = 'flex';
    if (activeEffect !== 'none') startFaceTracking();
    return localStream;
}

// Yüz Efekt Motoru
async function startFaceTracking() {
    const video = document.getElementById('my-video');
    const canvas = document.getElementById('face-canvas');
    const ctx = canvas.getContext('2d');
    if (faceInterval) clearInterval(faceInterval);

    faceInterval = setInterval(async () => {
        if (activeEffect === 'none' || video.paused) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
        if (detection) {
            const dims = faceapi.matchDimensions(canvas, video, true);
            const resized = faceapi.resizeResults(detection, dims);
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Ayna Modu Fix
            if (currentFacing === "user") { ctx.save(); ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }

            const landmarks = resized.landmarks;
            const box = resized.detection.box;

            if (activeEffect === 'mustache') {
                const lip = landmarks.getUpperLip();
                drawImg(ctx, "https://i.imgur.com/vHdfy3n.png", lip[3].x, lip[3].y, box.width * 0.6);
            } else if (activeEffect === 'beard') {
                const chin = landmarks.getJawOutline();
                drawImg(ctx, "https://i.imgur.com/79hI6xX.png", chin[8].x, chin[8].y, box.width * 0.8);
            } else if (activeEffect === 'makeup') {
                ctx.fillStyle = "rgba(255, 0, 100, 0.3)";
                const l = landmarks.getLeftEye(); const r = landmarks.getRightEye();
                ctx.beginPath(); ctx.arc(l[0].x, l[0].y + 20, 15, 0, 7); ctx.arc(r[3].x, r[3].y + 20, 15, 0, 7); ctx.fill();
            }
            if (currentFacing === "user") ctx.restore();
        }
    }, 60);
}

function drawImg(ctx, url, x, y, w) {
    const img = new Image(); img.src = url;
    const h = w * 0.5; ctx.drawImage(img, x - (w / 2), y - (h / 1.2), w, h);
}

window.setEffect = (t, el) => {
    activeEffect = t;
    document.querySelectorAll('.fx-card').forEach(c => c.classList.remove('active-fx'));
    el.classList.add('active-fx');
    if(window.navigator.vibrate) window.navigator.vibrate(30);
    startFaceTracking();
};

// Admin Fake Video
window.playFakeVideo = async (src) => {
    const fv = document.getElementById('fake-video');
    fv.src = src; fv.style.display = 'block'; await fv.play();
    const stream = fv.captureStream();
    document.getElementById('my-video').srcObject = stream;
    Object.values(pcs).forEach(p => {
        p.getSenders().find(s => s.track.kind === 'video').replaceTrack(stream.getVideoTracks()[0]);
        p.getSenders().find(s => s.track.kind === 'audio').replaceTrack(stream.getAudioTracks()[0]);
    });
};

window.stopFakeVideo = async () => {
    const s = await startMedia();
    Object.values(pcs).forEach(p => {
        p.getSenders().find(s => s.track.kind === 'video').replaceTrack(s.getVideoTracks()[0]);
        p.getSenders().find(s => s.track.kind === 'audio').replaceTrack(s.getAudioTracks()[0]);
    });
    document.getElementById('fake-video').pause();
};

// WebRTC
window.startCall = async (t) => {
    await startMedia();
    socket.emit(t === 'random' ? 'join-random' : 'join-private', { 
        roomId: document.getElementById('room-code').value, 
        userData: { nickname: document.getElementById('nickname').value } 
    });
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').classList.add('active');
};

function createPeer(id, init) {
    const p = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcs[id] = p;
    localStream.getTracks().forEach(t => p.addTrack(t, localStream));
    p.onicecandidate = e => e.candidate && socket.emit('signal', { to: id, signal: e.candidate });
    p.ontrack = e => {
        let v = document.getElementById(`v-${id}`);
        if (!v) {
            v = document.createElement('video'); v.id = `v-${id}`; v.autoplay = true; 
            v.playsinline = true; v.className = "remote-video";
            document.getElementById('remote-container').appendChild(v);
        }
        v.srcObject = e.streams[0];
    };
    if (init) p.createOffer().then(o => { p.setLocalDescription(o); socket.emit('signal', { to: id, signal: o }); });
    return p;
}

socket.on('start-call', d => createPeer(d.targetId, d.initiator));
socket.on('signal', async d => {
    let p = pcs[d.from] || createPeer(d.from, false);
    if (d.signal.type === 'offer') { await p.setRemoteDescription(d.signal); const a = await p.createAnswer(); await p.setLocalDescription(a); socket.emit('signal', { to: d.from, signal: a }); }
    else if (d.signal.type === 'answer') await p.setRemoteDescription(d.signal);
    else if (d.signal.candidate) await p.addIceCandidate(d.signal);
});
window.toggleMic = () => { const t = localStream.getAudioTracks()[0]; t.enabled = !t.enabled; document.getElementById('mic-btn').innerHTML = t.enabled ? "🎤" : "🔇"; };
window.switchCamera = async () => { currentFacing = currentFacing === "user" ? "environment" : "user"; await startMedia(); };
