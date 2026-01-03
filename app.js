const socket = io();
let localStream, processedStream, audioCtx, source, destination, processor;
let currentMode = "user"; // Kamera Modu
let fxType = "normal"; // Ses Tipi
let visualFilter = "none"; // Bıyık vb.

// --- SES EFEKT MOTORU (Gelişmiş) ---
async function applyAudioFX(stream) {
    if (audioCtx) audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    source = audioCtx.createMediaStreamSource(stream);
    destination = audioCtx.createMediaStreamDestination();
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
        let input = e.inputBuffer.getChannelData(0);
        let output = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
            if (fxType === 'bebek') output[i] = input[i * 2 % input.length];
            else if (fxType === 'kalin') output[i] = input[Math.floor(i / 1.5)];
            else if (fxType === 'kadin') output[i] = input[i * 1.3 % input.length];
            else output[i] = input[i];
        }
    };
    source.connect(processor); processor.connect(destination);
    return new MediaStream([...stream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
}

// --- KAMERA YÖNETİMİ (Mirror Fix) ---
async function startCam() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentMode }, audio: true
    });
    localStream = stream;
    processedStream = await applyAudioFX(stream);
    
    const myVideo = document.getElementById('my-video');
    myVideo.srcObject = stream;
    
    // Arka kamerada ters gösterme (Mirror) kapatılır
    if (currentMode === "user") myVideo.classList.add('mirror');
    else myVideo.classList.remove('mirror');
}

window.flipCamera = async () => {
    currentMode = (currentMode === "user") ? "environment" : "user";
    await startCam();
    // Bağlantı varsa track değiştir (Ses kopmadan)
    Object.values(pcs).forEach(pc => {
        const videoTrack = processedStream.getVideoTracks()[0];
        const audioTrack = processedStream.getAudioTracks()[0];
        pc.getSenders().find(s => s.track.kind === 'video').replaceTrack(videoTrack);
        pc.getSenders().find(s => s.track.kind === 'audio').replaceTrack(audioTrack);
    });
};

window.toggleMic = () => {
    const t = localStream.getAudioTracks()[0];
    t.enabled = !t.enabled;
    document.getElementById('mic-btn').classList.toggle('active', !t.enabled);
};

// --- EFEKT MENÜSÜ ---
window.toggleFXPanel = () => {
    const p = document.getElementById('fx-panel');
    p.style.display = (p.style.display === 'block') ? 'none' : 'block';
};

window.setAudioFx = (type) => { fxType = type; toggleFXPanel(); };

// --- LOBİ VE EŞLEŞME (WebRTC) ---
let pcs = {};
window.joinApp = async () => {
    await startCam();
    socket.emit('join-random', { nickname: document.getElementById('nickname').value || "Vampir" });
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').classList.add('active');
};

socket.on('matched', (data) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcs[data.partnerId] = pc;
    processedStream.getTracks().forEach(t => pc.addTrack(t, processedStream));
    
    pc.onicecandidate = e => e.candidate && socket.emit('signal', { to: data.partnerId, signal: e.candidate });
    pc.ontrack = e => {
        document.getElementById('partner-video').srcObject = e.streams[0];
    };

    if (data.initiator) {
        pc.createOffer().then(o => { pc.setLocalDescription(o); socket.emit('signal', { to: data.partnerId, signal: o }); });
    }
    
    socket.on('signal', async d => {
        if (d.from !== data.partnerId) return;
        if (d.signal.type === 'offer') {
            await pc.setRemoteDescription(d.signal);
            const a = await pc.createAnswer(); await pc.setLocalDescription(a);
            socket.emit('signal', { to: d.from, signal: a });
        } else if (d.signal.type === 'answer') await pc.setRemoteDescription(d.signal);
        else if (d.signal.candidate) await pc.addIceCandidate(d.signal);
    });
});
