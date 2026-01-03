const socket = io();
let localStream, processedStream, audioCtx, pc;
let facingMode = "user"; 
let audioFx = "normal";

// Kar Efekti
setInterval(() => {
    const s = document.createElement('div');
    s.className = 'snowflake'; s.innerText = '❄';
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = (Math.random() * 3 + 2) + 's';
    document.getElementById('snow-box').appendChild(s);
    setTimeout(() => s.remove(), 5000);
}, 400);

window.randomAvatar = () => {
    document.getElementById('avatar-img').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${Math.random()}`;
};

// --- SES EFEKT SİSTEMİ ---
async function setupAudioProcessing(stream) {
    if (audioCtx) audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const destination = audioCtx.createMediaStreamDestination();
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
        let input = e.inputBuffer.getChannelData(0);
        let output = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
            if (audioFx === 'bebek') output[i] = input[i * 2 % input.length];
            else if (audioFx === 'kalin') output[i] = input[Math.floor(i / 1.6)];
            else if (audioFx === 'kadin') output[i] = input[i * 1.35 % input.length];
            else if (audioFx === 'yanki') output[i] = input[i] + (output[i-2500] || 0) * 0.4;
            else output[i] = input[i];
        }
    };

    source.connect(processor);
    processor.connect(destination);
    return new MediaStream([...stream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
}

// --- MEDYA BAŞLAT ---
async function initMedia() {
    localStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: facingMode }, audio: true 
    });
    processedStream = await setupAudioProcessing(localStream);
    
    const myVideo = document.getElementById('my-video');
    myVideo.srcObject = localStream;
    // Mirror Düzeltme
    if (facingMode === "user") myVideo.classList.add('mirror');
    else myVideo.classList.remove('mirror');
}

window.startApp = async () => {
    await initMedia();
    socket.emit('join-random', { nickname: document.getElementById('nickname').value || "Vampir" });
    document.getElementById('lobby').classList.remove('active');
    document.getElementById('game').classList.add('active');
};

window.flipCamera = async () => {
    facingMode = (facingMode === "user") ? "environment" : "user";
    await initMedia();
    if (pc) {
        const vTrack = processedStream.getVideoTracks()[0];
        const aTrack = processedStream.getAudioTracks()[0];
        const vSender = pc.getSenders().find(s => s.track.kind === 'video');
        const aSender = pc.getSenders().find(s => s.track.kind === 'audio');
        vSender.replaceTrack(vTrack);
        aSender.replaceTrack(aTrack);
    }
};

window.toggleMic = () => {
    const t = localStream.getAudioTracks()[0];
    t.enabled = !t.enabled;
    document.getElementById('mic-btn').classList.toggle('active', !t.enabled);
};

window.toggleFxMenu = () => {
    const m = document.getElementById('fx-menu');
    m.style.display = (m.style.display === 'block') ? 'none' : 'block';
};

window.setAudioFx = (fx) => { audioFx = fx; toggleFxMenu(); };

// --- WebRTC ---
socket.on('matched', async (data) => {
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    processedStream.getTracks().forEach(t => pc.addTrack(t, processedStream));

    pc.onicecandidate = e => e.candidate && socket.emit('signal', { to: data.partnerId, signal: e.candidate });
    pc.ontrack = e => document.getElementById('partner-video').srcObject = e.streams[0];

    if (data.initiator) {
        const o = await pc.createOffer();
        await pc.setLocalDescription(o);
        socket.emit('signal', { to: data.partnerId, signal: o });
    }

    socket.on('signal', async d => {
        if (d.from !== data.partnerId) return;
        if (d.signal.type === 'offer') {
            await pc.setRemoteDescription(d.signal);
            const a = await pc.createAnswer();
            await pc.setLocalDescription(a);
            socket.emit('signal', { to: d.from, signal: a });
        } else if (d.signal.type === 'answer') await pc.setRemoteDescription(d.signal);
        else if (d.signal.candidate) await pc.addIceCandidate(d.signal);
    });
});

socket.on('user-disconnected', () => location.reload());
