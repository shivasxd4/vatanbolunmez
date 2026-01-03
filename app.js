const socket = io();
let localStream, pc, currentRoomId, partnerId;
let audioCtx, currentEffect = 'normal';

// Kar Efekti Başlat
setInterval(() => {
    const s = document.createElement('div');
    s.className = 'snowflake'; s.innerText = '❄';
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = (Math.random() * 3 + 2) + 's';
    s.style.fontSize = Math.random() * 20 + 10 + 'px';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 5000);
}, 400);

// Avatar Değiştir
document.getElementById('avatar-img').onclick = function() {
    this.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${Math.random()}`;
};

// Ses İşleme (Bebek, Kalın, Yankı)
async function getProcessedStream(stream) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const destination = audioCtx.createMediaStreamDestination();
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
        let input = e.inputBuffer.getChannelData(0);
        let output = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
            if (currentEffect === 'bebek') output[i] = input[i * 2 % input.length];
            else if (currentEffect === 'kalin') output[i] = input[Math.floor(i / 1.5)];
            else if (currentEffect === 'yanki') output[i] = input[i] + (output[i-2000] || 0) * 0.4;
            else output[i] = input[i];
        }
    };

    source.connect(processor);
    processor.connect(destination);
    return new MediaStream([...stream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
}

// Eşleşme Başlat
document.getElementById('btn-join').onclick = async () => {
    try {
        const rawStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('my-video').srcObject = rawStream;
        localStream = await getProcessedStream(rawStream);
        
        socket.emit('join-random', { 
            nickname: document.getElementById('nickname').value || "Gizemli",
            avatar: document.getElementById('avatar-img').src 
        });

        document.getElementById('lobby').classList.remove('active');
        document.getElementById('game-room').classList.add('active');
    } catch (e) { alert("Kamera/Mikrofon izni gerekli!"); }
};

socket.on('matched', async (data) => {
    currentRoomId = data.roomId;
    partnerId = data.partnerId;
    document.getElementById('status').innerText = "Eşleşti: " + data.partner.nickname;
    
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    
    pc.onicecandidate = e => e.candidate && socket.emit('signal', { to: partnerId, signal: e.candidate });
    pc.ontrack = e => document.getElementById('peer-video').srcObject = e.streams[0];

    if (data.initiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('signal', { to: partnerId, signal: offer });
    }
});

socket.on('signal', async d => {
    if (!pc) return;
    if (d.signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(d.signal));
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        socket.emit('signal', { to: d.from, signal: ans });
    } else if (d.signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(d.signal));
    } else {
        await pc.addIceCandidate(new RTCIceCandidate(d.signal));
    }
});

// Fonksiyonlar
window.setEffect = (fx, btn) => {
    currentEffect = fx;
    document.querySelectorAll('.fx-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
};

document.getElementById('btn-send').onclick = () => {
    const i = document.getElementById('chat-input');
    if (!i.value) return;
    socket.emit('send-chat', { roomId: currentRoomId, msg: i.value, from: "Ben" });
    i.value = "";
};

socket.on('receive-chat', d => {
    const box = document.getElementById('chat-msgs');
    box.innerHTML += `<div><b>${d.from}:</b> ${d.msg}</div>`;
    box.scrollTop = box.scrollHeight;
});

socket.on('partner-disconnected', () => {
    document.getElementById('status').innerText = "Partner ayrıldı. Lütfen sayfayı yenileyin.";
    if(pc) pc.close();
});
