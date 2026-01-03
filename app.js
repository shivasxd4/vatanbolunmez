const socket = io();
let localStream, processedStream, audioCtx, pc;
let currentFacing = "user";
let audioFx = "normal";
let isMustacheOn = false;
let isBeautyOn = false;

// --- MODEL YÜKLEME ---
async function loadModels() {
    await faceapi.nets.tinyFaceDetector.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights');
    await faceapi.nets.faceLandmark68Net.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights');
    console.log("Modeller Yüklendi!");
}
loadModels();

// --- SES MOTORU ---
async function setupAudioFX(stream) {
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
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing }, audio: true
    });
    processedStream = await setupAudioFX(localStream);
    const videoEl = document.getElementById('my-video');
    videoEl.srcObject = localStream;
    currentFacing === "user" ? videoEl.classList.add('mirror') : videoEl.classList.remove('mirror');
    
    if(isMustacheOn) startFaceTracking();
    return processedStream;
}

// --- KAMERA DEĞİŞTİR (SES KORUMALI) ---
window.switchCamera = async () => {
    currentFacing = currentFacing === "user" ? "environment" : "user";
    const newStream = await initMedia();
    if (pc) {
        const vTrack = newStream.getVideoTracks()[0];
        const aTrack = newStream.getAudioTracks()[0];
        const vSender = pc.getSenders().find(s => s.track.kind === 'video');
        const aSender = pc.getSenders().find(s => s.track.kind === 'audio');
        if (vSender) vSender.replaceTrack(vTrack);
        if (aSender) aSender.replaceTrack(aTrack);
    }
};

// --- FACE TRACKING (BIYIK) ---
async function startFaceTracking() {
    const video = document.getElementById('my-video');
    const canvas = document.getElementById('face-canvas');
    const img = document.getElementById('mustache-img');
    const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
        if (!isMustacheOn) {
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

        resizedDetections.forEach(detection => {
            const marks = detection.landmarks.getUpperLip(); // Üst dudak noktaları
            const x = marks[0].x;
            const y = marks[0].y - 10;
            canvas.getContext('2d').drawImage(img, x, y, 60, 30);
        });
    }, 100);
}

// --- KONTROLLER ---
window.toggleMustache = () => {
    isMustacheOn = !isMustacheOn;
    if (isMustacheOn) startFaceTracking();
};

window.changeAudioFx = (type) => audioFx = type;

window.toggleBeauty = () => {
    isBeautyOn = !isBeautyOn;
    document.getElementById('my-video').style.filter = isBeautyOn ? "brightness(1.1) saturate(1.2) contrast(1.1) blur(0.2px)" : "none";
};

window.startCall = async (type, limit = 2) => {
    await initMedia();
    const userData = { nickname: document.getElementById('nickname').value || "Gizemli" };
    if (type === 'random') socket.emit('join-random', userData);
    else socket.emit('join-private', { roomId: document.getElementById('room-code').value, limit, userData });
    
    document.getElementById('lobby').classList.remove('active');
    document.getElementById('game').classList.add('active');
};
