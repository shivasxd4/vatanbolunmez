const socket = io();

// --- DEĞİŞKENLER ---
let localStream, processedStream, audioCtx, pc;
let currentFacing = "user";
let currentAudioFx = "normal";
let isMustacheOn = false;
let isBeautyOn = false;
let pcs = {}; // Çoklu bağlantı takibi
let detectorInterval;

// --- 1. FACE-API MODELLERİNİ YÜKLE ---
// GitHub master branch üzerindeki güncel raw dosyalarını kullanır
async function loadFaceModels() {
    const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        console.log("VK: Modeller başarıyla yüklendi.");
    } catch (err) {
        console.error("Model yükleme hatası! Lütfen internet bağlantısını kontrol et:", err);
    }
}
loadFaceModels();

// --- 2. SES İŞLEME MOTORU (EFEKTLER) ---
async function setupAudioProcessing(stream) {
    if (audioCtx) await audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    const source = audioCtx.createMediaStreamSource(stream);
    const destination = audioCtx.createMediaStreamDestination();
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
        let input = e.inputBuffer.getChannelData(0);
        let output = e.outputBuffer.getChannelData(0);
        
        for (let i = 0; i < input.length; i++) {
            if (currentAudioFx === 'bebek') {
                output[i] = input[i * 2 % input.length];
            } else if (currentAudioFx === 'kadin') {
                output[i] = input[i * 1.35 % input.length];
            } else if (currentAudioFx === 'kalin') {
                output[i] = input[Math.floor(i / 1.7)];
            } else {
                output[i] = input[i]; // Normal
            }
        }
    };

    source.connect(processor);
    processor.connect(destination);
    
    // Görüntü track'i ile işlenmiş ses track'ini birleştir
    return new MediaStream([
        ...stream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
    ]);
}

// --- 3. MEDYA YÖNETİMİ ---
async function startMedia() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: currentFacing,
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: true
        });

        processedStream = await setupAudioProcessing(localStream);
        
        const myVideo = document.getElementById('my-video');
        myVideo.srcObject = localStream;
        
        // Ayna görüntüsü ayarı
        if (currentFacing === "user") {
            myVideo.classList.add('mirror');
        } else {
            myVideo.classList.remove('mirror');
        }

        if (isMustacheOn) startMustacheTracking();
        
        return processedStream;
    } catch (err) {
        console.error("Medya erişim hatası:", err);
        alert("Kamera veya mikrofon izni verilmedi!");
    }
}

// --- 4. BIYIK TAKİBİ (FACE-API) ---
async function startMustacheTracking() {
    const video = document.getElementById('my-video');
    const canvas = document.getElementById('face-canvas');
    const img = document.getElementById('mustache-img');
    const ctx = canvas.getContext('2d');

    if (detectorInterval) clearInterval(detectorInterval);

    detectorInterval = setInterval(async () => {
        if (!isMustacheOn || video.paused || video.ended) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();

        if (detection) {
            const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
            faceapi.matchDimensions(canvas, displaySize);
            const resizedResults = faceapi.resizeResults(detection, displaySize);
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Üst dudak landmarklarını al (Index 33-35 arası bıyık bölgesi)
            const landmarks = resizedResults.landmarks.getUpperLip();
            const lipCenter = landmarks[3]; 

            const mustacheWidth = resizedResults.detection.box.width * 0.6;
            const mustacheHeight = mustacheWidth * 0.4;

            ctx.drawImage(
                img,
                lipCenter.x - (mustacheWidth / 2),
                lipCenter.y - (mustacheHeight / 1.2),
                mustacheWidth,
                mustacheHeight
            );
        }
    }, 80);
}

// --- 5. UI BUTON FONKSİYONLARI ---
window.startCall = async (type, limit = 2) => {
    // Android/iOS için hafif titreşim
    if (window.navigator.vibrate) window.navigator.vibrate(50);
    
    await startMedia();
    const nickname = document.getElementById('nickname').value || "Gizemli";
    
    if (type === 'random') {
        socket.emit('join-random', { nickname });
    } else {
        const code = document.getElementById('room-code').value;
        if (!code) return alert("Lütfen bir oda kodu gir!");
        socket.emit('join-private', { roomId: code, limit, userData: { nickname } });
    }
    
    document.getElementById('lobby').classList.remove('active');
    document.getElementById('game').classList.add('active');
};

window.toggleMic = () => {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const btn = document.getElementById('mic-btn');
        btn.innerHTML = audioTrack.enabled ? "🎤" : "🔇";
        btn.classList.toggle('muted', !audioTrack.enabled);
        if (window.navigator.vibrate) window.navigator.vibrate(30);
    }
};

window.switchCamera = async () => {
    if (window.navigator.vibrate) window.navigator.vibrate(70);
    currentFacing = (currentFacing === "user") ? "environment" : "user";
    const newStream = await startMedia();
    
    // Mevcut tüm WebRTC bağlantılarını yeni kamera ile güncelle
    Object.values(pcs).forEach(peerConnection => {
        const videoTrack = newStream.getVideoTracks()[0];
        const audioTrack = newStream.getAudioTracks()[0];
        
        const videoSender = peerConnection.getSenders().find(s => s.track.kind === 'video');
        const audioSender = peerConnection.getSenders().find(s => s.track.kind === 'audio');
        
        if (videoSender) videoSender.replaceTrack(videoTrack);
        if (audioSender) audioSender.replaceTrack(audioTrack);
    });
};

window.toggleMustache = (element) => {
    isMustacheOn = !isMustacheOn;
    element.classList.toggle('active', isMustacheOn);
    if (window.navigator.vibrate) window.navigator.vibrate(40);
    
    if (isMustacheOn) {
        startMustacheTracking();
    } else {
        if (detectorInterval) clearInterval(detectorInterval);
        const canvas = document.getElementById('face-canvas');
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
};

window.setAudioFx = (type, element) => {
    currentAudioFx = type;
    document.querySelectorAll('.fx-card').forEach(card => card.classList.remove('active'));
    element.classList.add('active');
    if (window.navigator.vibrate) window.navigator.vibrate(20);
};

window.toggleBeauty = (element) => {
    isBeautyOn = !isBeautyOn;
    element.classList.toggle('active', isBeautyOn);
    const video = document.getElementById('my-video');
    video.style.filter = isBeautyOn ? "brightness(1.1) saturate(1.1) contrast(1.1) blur(0.3px)" : "none";
};

// --- 6. WebRTC SİNYALLEŞME MANTIĞI ---
function createPeerConnection(targetId, initiator) {
    const peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    pcs[targetId] = peer;

    // Efektli stream'i (processedStream) gönderiyoruz
    processedStream.getTracks().forEach(track => {
        peer.addTrack(track, processedStream);
    });

    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { to: targetId, signal: event.candidate });
        }
    };

    peer.ontrack = (event) => {
        let remoteVideo = document.getElementById(`vid-${targetId}`);
        if (!remoteVideo) {
            remoteVideo = document.createElement('video');
            remoteVideo.id = `vid-${targetId}`;
            remoteVideo.autoplay = true;
            remoteVideo.playsinline = true;
            remoteVideo.className = "remote-video";
            document.getElementById('remote-container').appendChild(remoteVideo);
        }
        remoteVideo.srcObject = event.streams[0];
    };

    if (initiator) {
        peer.createOffer().then(offer => {
            peer.setLocalDescription(offer);
            socket.emit('signal', { to: targetId, signal: offer });
        });
    }

    return peer;
}

// Socket Olay Dinleyicileri
socket.on('start-call', data => createPeerConnection(data.targetId, data.initiator));
socket.on('existing-users', users => users.forEach(id => createPeerConnection(id, true)));
socket.on('user-joined-room', data => createPeerConnection(data.id, false));

socket.on('signal', async data => {
    let peer = pcs[data.from];
    if (!peer) peer = createPeerConnection(data.from, false);

    try {
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
    } catch (err) {
        console.error("WebRTC Sinyal Hatası:", err);
    }
});

socket.on('user-left', id => {
    if (pcs[id]) {
        pcs[id].close();
        delete pcs[id];
    }
    const videoEl = document.getElementById(`vid-${id}`);
    if (videoEl) videoEl.remove();
});
