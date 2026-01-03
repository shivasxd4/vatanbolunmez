const socket = io();
let localStream, pc;
let currentFacing = "user";
let pcs = {};
let trackerTask;

// --- MEDYA BAŞLATMA ---
async function startMedia() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    
    // Ses efektlerini sildik, Clownfish kullanan mikrofonu direkt alıyoruz
    localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing, width: 480 },
        audio: true
    });

    const video = document.getElementById('my-video');
    video.srcObject = localStream;
    
    currentFacing === "user" ? video.classList.add('mirror') : video.classList.remove('mirror');
    return localStream;
}

// --- YENİ BIYIK TAKİP SİSTEMİ (TRACKING.JS) ---
window.toggleMustache = () => {
    const mustache = document.getElementById('mustache-overlay');
    const video = document.getElementById('my-video');
    const btn = document.getElementById('biyik-btn');

    if (trackerTask) {
        trackerTask.stop();
        trackerTask = null;
        mustache.style.display = 'none';
        btn.classList.remove('active-fx');
        return;
    }

    btn.classList.add('active-fx');
    mustache.style.display = 'block';

    const tracker = new tracking.ObjectTracker('face');
    tracker.setInitialScale(4);
    tracker.setStepSize(2);
    tracker.setEdgesDensity(0.1);

    trackerTask = tracking.track('#my-video', tracker);

    tracker.on('track', event => {
        if (event.data.length === 0) return;

        event.data.forEach(rect => {
            // Bıyığı burnun altına, ağzın üstüne konumlandırıyoruz
            // rect.x, rect.y, rect.width, rect.height yüzün karesini verir
            const mWidth = rect.width * 0.5;
            const mHeight = mWidth * 0.4;
            
            // Yüz karesine göre oranlama
            mustache.style.width = mWidth + 'px';
            mustache.style.left = (rect.x + (rect.width / 4)) + 'px';
            mustache.style.top = (rect.y + (rect.height * 0.65)) + 'px';
        });
    });
};

// --- WebRTC BAĞLANTI ---
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

// --- DİĞER FONKSİYONLAR ---
window.startCall = async (type, limit = 2) => {
    await startMedia();
    const nick = document.getElementById('nickname').value || "Vampir";
    socket.emit(type === 'random' ? 'join-random' : 'join-private', { 
        roomId: document.getElementById('room-code').value, 
        limit, 
        userData: { nickname: nick } 
    });
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').classList.add('active');
};

window.toggleMic = () => {
    const t = localStream.getAudioTracks()[0];
    t.enabled = !t.enabled;
    document.getElementById('mic-btn').innerHTML = t.enabled ? "🎤" : "🔇";
};

window.switchCamera = async () => {
    currentFacing = currentFacing === "user" ? "environment" : "user";
    const newStream = await startMedia();
    Object.values(pcs).forEach(p => {
        p.getSenders().find(s => s.track.kind === 'video').replaceTrack(newStream.getVideoTracks()[0]);
        p.getSenders().find(s => s.track.kind === 'audio').replaceTrack(newStream.getAudioTracks()[0]);
    });
};

// --- SİNYALLEŞME ---
socket.on('start-call', d => createPeer(d.targetId, d.initiator));
socket.on('existing-users', u => u.forEach(id => createPeer(id, true)));
socket.on('user-joined-room', d => createPeer(d.id, false));
socket.on('signal', async d => {
    let p = pcs[d.from] || createPeer(d.from, false);
    if (d.signal.type === 'offer') {
        await p.setRemoteDescription(d.signal);
        const a = await p.createAnswer(); await p.setLocalDescription(a);
        socket.emit('signal', { to: d.from, signal: a });
    } else if (d.signal.type === 'answer') await p.setRemoteDescription(d.signal);
    else if (d.signal.candidate) await p.addIceCandidate(d.signal);
});
socket.on('user-left', id => { if(pcs[id]) pcs[id].close(); delete pcs[id]; document.getElementById(`v-${id}`)?.remove(); });
