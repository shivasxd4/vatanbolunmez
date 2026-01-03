const socket = io();
let localStream, processedStream, audioCtx;
let pcs = {}; // Çoklu bağlantı desteği
let myRoomId = null;
let facingMode = "user";
let audioFx = "normal";

// Kar Efekti
function createSnow() {
    const s = document.createElement('div');
    s.className = 'snowflake'; s.innerText = '❄';
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = (Math.random() * 3 + 2) + 's';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 5000);
}
setInterval(createSnow, 400);

// --- SES İŞLEME ---
async function setupAudio(stream) {
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
            else if (audioFx === 'kadin') output[i] = input[i * 1.3 % input.length];
            else if (audioFx === 'yanki') output[i] = input[i] + (output[i-2500] || 0) * 0.4;
            else output[i] = input[i];
        }
    };
    source.connect(processor);
    processor.connect(destination);
    return new MediaStream([...stream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
}

// --- MEDYA ---
async function initMedia() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
    processedStream = await setupAudio(localStream);
    const myVid = document.getElementById('my-video');
    myVid.srcObject = localStream;
    facingMode === "user" ? myVid.classList.add('mirror') : myVid.classList.remove('mirror');
}

// --- GİRİŞ VE EŞLEŞME ---
window.startRandom = async () => {
    await initMedia();
    socket.emit('join-random', { nickname: document.getElementById('nickname').value || "Vampir" });
    switchToGame();
};

window.startPrivate = async (limit) => {
    const code = document.getElementById('room-code').value;
    if (!code) return alert("Oda kodu gir!");
    await initMedia();
    myRoomId = code;
    socket.emit('join-private', { roomId: code, limit, userData: { nickname: "Üye" } });
    switchToGame();
};

function switchToGame() {
    document.getElementById('lobby').classList.remove('active');
    document.getElementById('game').classList.add('active');
}

// --- PEER CONNECTION MANTIĞI ---
function createPeer(targetId, initiator) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcs[targetId] = pc;

    processedStream.getTracks().forEach(track => pc.addTrack(track, processedStream));

    pc.onicecandidate = e => {
        if (e.candidate) socket.emit('signal', { to: targetId, signal: e.candidate });
    };

    pc.ontrack = e => {
        let remoteVid = document.getElementById(`vid-${targetId}`);
        if (!remoteVid) {
            remoteVid = document.createElement('video');
            remoteVid.id = `vid-${targetId}`;
            remoteVid.autoplay = true;
            remoteVid.playsinline = true;
            remoteVid.className = "remote-video";
            remoteVid.onclick = () => remoteVid.classList.toggle('fullscreen');
            document.getElementById('video-grid').appendChild(remoteVid);
        }
        remoteVid.srcObject = e.streams[0];
    };

    if (initiator) {
        pc.createOffer().then(offer => {
            pc.setLocalDescription(offer);
            socket.emit('signal', { to: targetId, signal: offer });
        });
    }

    return pc;
}

// --- SOCKET OLAYLARI ---
socket.on('start-call', data => createPeer(data.targetId, data.initiator));

socket.on('existing-users', users => {
    users.forEach(id => createPeer(id, true));
});

socket.on('user-joined-room', data => {
    createPeer(data.id, false);
});

socket.on('signal', async data => {
    let pc = pcs[data.from];
    if (!pc) pc = createPeer(data.from, false);

    if (data.signal.type === 'offer') {
        await pc.setRemoteDescription(data.signal);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { to: data.from, signal: answer });
    } else if (data.signal.type === 'answer') {
        await pc.setRemoteDescription(data.signal);
    } else if (data.signal.candidate) {
        await pc.addIceCandidate(data.signal);
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

// --- KONTROLLER ---
window.flipCamera = async () => {
    facingMode = facingMode === "user" ? "environment" : "user";
    await initMedia();
    Object.values(pcs).forEach(pc => {
        const videoTrack = processedStream.getVideoTracks()[0];
        const sender = pc.getSenders().find(s => s.track.kind === 'video');
        sender.replaceTrack(videoTrack);
    });
};

window.toggleMic = () => {
    const t = localStream.getAudioTracks()[0];
    t.enabled = !t.enabled;
    document.getElementById('mic-btn').innerText = t.enabled ? "🎤" : "🔇";
};

window.setAudioFx = (fx) => {
    audioFx = fx;
    document.getElementById('fx-menu').style.display = 'none';
};
