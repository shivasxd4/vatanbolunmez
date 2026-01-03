const socket = io();

// Global Değişkenler
let localStream, processedStream, audioCtx, pc;
let currentFacing = "user";
let audioFx = "normal";
let isMustacheActive = false;
let isBeautyOn = false;
let facialDetectionInterval;
let pcs = {}; // Çoklu bağlantı (Özel odalar için)

// 1. --- MODELLERİN YÜKLENMESİ ---
async function loadFaceModels() {
    const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/weights';
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        console.log("VK: Yüz Takip Modelleri Hazır.");
    } catch (err) {
        console.error("Model yükleme hatası:", err);
    }
}
loadFaceModels();

// 2. --- SES EFEKT MOTORU ---
async function applyAudioFX(stream) {
    if (audioCtx) await audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    const source = audioCtx.createMediaStreamSource(stream);
    const destination = audioCtx.createMediaStreamDestination();
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
        let input = e.inputBuffer.getChannelData(0);
        let output = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
            if (audioFx === 'bebek') output[i] = input[i * 2 % input.length];
            else if (audioFx === 'kadin') output[i] = input[i * 1.35 % input.length];
            else if (audioFx === 'kalin') output[i] = input[Math.floor(i / 1.7)];
            else output[i] = input[i]; // Normal ses
        }
    };

    source.connect(processor);
    processor.connect(destination);
    
    // Görüntü ile efektli sesi birleştir
    return new MediaStream([
        ...stream.getVideoTracks(), 
        ...destination.stream.getAudioTracks()
    ]);
}

// 3. --- MEDYA BAŞLATMA ---
async function initMedia() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacing, width: { ideal: 640 }, height: { ideal: 480 } },
            audio: true
        });

        processedStream = await applyAudioFX(localStream);
        
        const myVid = document.getElementById('my-video');
        myVid.srcObject = localStream;
        
        // Mirror efekti (Ön kamerada ayna görüntüsü)
        currentFacing === "user" ? myVid.classList.add('mirror') : myVid.classList.remove('mirror');
        
        if (isMustacheActive) startFacialTracking();
        return processedStream;
    } catch (err) {
        alert("Kamera veya Mikrofon izni reddedildi!");
    }
}

// 4. --- BIYIK TAKİP ALGORİTMASI ---
async function startFacialTracking() {
    const video = document.getElementById('my-video');
    const canvas = document.getElementById('face-canvas');
    const img = document.getElementById('mustache-img');
    const ctx = canvas.getContext('2d');

    if (facialDetectionInterval) clearInterval(facialDetectionInterval);

    facialDetectionInterval = setInterval(async () => {
        if (!isMustacheActive || video.paused || video.ended) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();

        if (detection) {
            const dims = faceapi.matchDimensions(canvas, video, true);
            const resized = faceapi.resizeResults(detection, dims);
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const landmarks = resized.landmarks.getUpperLip();
            const centerLip = landmarks[3]; 

            const mustacheWidth = resized.detection.box.width * 0.55;
            const mustacheHeight = mustacheWidth * 0.35;

            ctx.drawImage(
                img,
                centerLip.x - (mustacheWidth / 2),
                centerLip.y - (mustacheHeight / 1.1),
                mustacheWidth,
                mustacheHeight
            );
        }
    }, 60);
}

// 5. --- KONTROL BUTONLARI ---
window.startCall = async (type, limit = 2) => {
    if (window.navigator.vibrate) window.navigator.vibrate(50);
    await initMedia();
    const nick = document.getElementById('nickname').value || "Vampir";
    
    if (type === 'random') {
        socket.emit('join-random', { nickname: nick });
    } else {
        const code = document.getElementById('room-code').value;
        if (!code) return alert("Kod lazım!");
        socket.emit('join-private', { roomId: code, limit, userData: { nickname: nick } });
    }
    
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').classList.add('active');
};

window.toggleMic = () => {
    const track = localStream.getAudioTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        const btn = document.getElementById('mic-btn');
        btn.innerHTML = track.enabled ? "🎤" : "🔇";
        btn.classList.toggle('active', !track.enabled);
        if (window.navigator.vibrate) window.navigator.vibrate(30);
    }
};

window.switchCamera = async () => {
    if (window.navigator.vibrate) window.navigator.vibrate(80);
    currentFacing = currentFacing === "user" ? "environment" : "user";
    const newStream = await initMedia();
    
    // WebRTC bağlantısındaki trackleri güncelle (Ses kesilmeden)
    Object.values(pcs).forEach(peer => {
        const vTrack = newStream.getVideoTracks()[0];
        const aTrack = newStream.getAudioTracks()[0];
        const vSender = peer.getSenders().find(s => s.track.kind === 'video');
        const aSender = peer.getSenders().find(s => s.track.kind === 'audio');
        if (vSender) vSender.replaceTrack(vTrack);
        if (aSender) aSender.replaceTrack(aTrack);
    });
};

window.toggleMustache = (el) => {
    isMustacheActive = !isMustacheActive;
    el.classList.toggle('active', isMustacheActive);
    if (window.navigator.vibrate) window.navigator.vibrate(40);
    if (isMustacheActive) startFacialTracking();
};

window.changeAudioFx = (type, el) => {
    audioFx = type;
    document.querySelectorAll('.fx-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    if (window.navigator.vibrate) window.navigator.vibrate(20);
};

window.toggleBeauty = (el) => {
    isBeautyOn = !isBeautyOn;
    el.classList.toggle('active', isBeautyOn);
    document.getElementById('my-video').style.filter = isBeautyOn ? "brightness(1.1) saturate(1.1) contrast(1.05) blur(0.2px)" : "none";
};

// 6. --- WEB RTC SİNYALLEŞME ---
function createPeer(targetId, initiator) {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcs[targetId] = peer;

    processedStream.getTracks().forEach(track => peer.addTrack(track, processedStream));

    peer.onicecandidate = e => {
        if (e.candidate) socket.emit('signal', { to: targetId, signal: e.candidate });
    };

    peer.ontrack = e => {
        let remoteVid = document.getElementById(`vid-${targetId}`);
        if (!remoteVid) {
            remoteVid = document.createElement('video');
            remoteVid.id = `vid-${targetId}`;
            remoteVid.autoplay = true;
            remoteVid.playsinline = true;
            remoteVid.className = "remote-video";
            document.getElementById('remote-videos').appendChild(remoteVid);
        }
        remoteVid.srcObject = e.streams[0];
    };

    if (initiator) {
        peer.createOffer().then(o => {
            peer.setLocalDescription(o);
            socket.emit('signal', { to: targetId, signal: o });
        });
    }
    return peer;
}

socket.on('start-call', data => createPeer(data.targetId, data.initiator));
socket.on('existing-users', users => users.forEach(id => createPeer(id, true)));
socket.on('user-joined-room', data => createPeer(data.id, false));

socket.on('signal', async data => {
    let peer = pcs[data.from];
    if (!peer) peer = createPeer(data.from, false);

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
    if (pcs[id]) { pcs[id].close(); delete pcs[id]; }
    const el = document.getElementById(`vid-${id}`);
    if (el) el.remove();
});
