const socket = io();
let localStream, processedStream, audioCtx, pc;
let currentFacing = "user";
let audioFx = "normal";
let isMustacheOn = false;
let pcs = {}; // Çoklu bağlantı takibi

// Kar Efekti
setInterval(() => {
    const s = document.createElement('div');
    s.className = 'snowflake'; s.innerText = '❄';
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = '3s';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 3000);
}, 500);

// --- SES MOTORU ---
async function setupAudioFX(stream) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const destination = audioCtx.createMediaStreamDestination();
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
        let input = e.inputBuffer.getChannelData(0);
        let output = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
            if (audioFx === 'bebek') output[i] = input[i * 2 % input.length];
            else if (audioFx === 'kadin') output[i] = input[i * 1.4 % input.length];
            else if (audioFx === 'kalin') output[i] = input[Math.floor(i / 1.7)];
            else output[i] = input[i];
        }
    };
    source.connect(processor);
    processor.connect(destination);
    return new MediaStream([...stream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
}

// --- MEDYA BAŞLAT ---
async function initMedia() {
    try {
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacing, width: { ideal: 640 } },
            audio: true
        });
        
        processedStream = await setupAudioFX(localStream);
        const videoEl = document.getElementById('my-video');
        videoEl.srcObject = localStream;
        currentFacing === "user" ? videoEl.classList.add('mirror') : videoEl.classList.remove('mirror');
        return processedStream;
    } catch (err) {
        alert("Kamera hatası: " + err.message);
    }
}

// --- BAĞLANTI KURMA (DÜZELTİLDİ) ---
function createPeer(targetId, initiator) {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcs[targetId] = peer;

    // Kendi görüntümüzü ekliyoruz (ProcessedStream kullanıyoruz ki efekt gitsin)
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
        peer.createOffer().then(offer => {
            peer.setLocalDescription(offer);
            socket.emit('signal', { to: targetId, signal: offer });
        });
    }
    return peer;
}

// --- TUŞ FONKSİYONLARI ---
window.toggleMic = () => {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const btn = document.getElementById('mic-btn');
        btn.innerText = audioTrack.enabled ? "🎤" : "🔇";
        btn.classList.toggle('muted', !audioTrack.enabled);
    }
};

window.switchCamera = async () => {
    currentFacing = currentFacing === "user" ? "environment" : "user";
    const newStream = await initMedia();
    Object.values(pcs).forEach(p => {
        const vTrack = newStream.getVideoTracks()[0];
        const aTrack = newStream.getAudioTracks()[0];
        const vSender = p.getSenders().find(s => s.track && s.track.kind === 'video');
        const aSender = p.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (vSender) vSender.replaceTrack(vTrack);
        if (aSender) aSender.replaceTrack(aTrack);
    });
};

window.changeAudioFx = (type) => {
    audioFx = type;
    console.log("Ses Efekti:", type);
};

window.startCall = async (type, limit = 2) => {
    await initMedia();
    const nick = document.getElementById('nickname').value || "Gizemli";
    if (type === 'random') socket.emit('join-random', { nickname: nick });
    else socket.emit('join-private', { roomId: document.getElementById('room-code').value, limit, userData: { nickname: nick } });
    
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').classList.add('active');
};

// --- SİNYALLEŞME (DÜZELTİLDİ) ---
socket.on('start-call', data => createPeer(data.targetId, data.initiator));
socket.on('existing-users', users => users.forEach(id => createPeer(id, true)));
socket.on('user-joined-room', data => createPeer(data.id, false));

socket.on('signal', async data => {
    let pcItem = pcs[data.from];
    if (!pcItem) pcItem = createPeer(data.from, false);

    try {
        if (data.signal.type === 'offer') {
            await pcItem.setRemoteDescription(new RTCSessionDescription(data.signal));
            const answer = await pcItem.createAnswer();
            await pcItem.setLocalDescription(answer);
            socket.emit('signal', { to: data.from, signal: answer });
        } else if (data.signal.type === 'answer') {
            await pcItem.setRemoteDescription(new RTCSessionDescription(data.signal));
        } else if (data.signal.candidate) {
            await pcItem.addIceCandidate(new RTCIceCandidate(data.signal));
        }
    } catch (e) { console.error("Sinyal Hatası:", e); }
});

socket.on('user-left', id => {
    if (pcs[id]) { pcs[id].close(); delete pcs[id]; }
    const el = document.getElementById(`vid-${id}`);
    if (el) el.remove();
});
