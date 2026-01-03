<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>VK ROYALS</title>
    <link rel="stylesheet" href="style.css">
    <script src="/socket.io/socket.io.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/simple-peer/9.11.1/simplepeer.min.js"></script>
</head>
<body>
    <div id="master-wrap">
        <section id="lobby" class="screen active">
            <div class="lobby-card">
                <h1>VK ROYALS</h1>
                <div class="avatar-box">
                    <img id="avatar-img" src="https://api.dicebear.com/7.x/avataaars/svg?seed=1" onclick="nextAvatar()">
                </div>
                <input type="text" id="nickname" placeholder="Lakabın">
                <button class="btn-main" onclick="showCreateModal()">YENİ ODA</button>
                <div id="public-rooms" class="room-grid"></div>
                <input type="text" id="join-room-code" placeholder="Oda Kodu">
                <button class="btn-main" onclick="joinByCode()">KATIL</button>
            </div>

            <div id="create-modal" class="modal">
                <div class="modal-content">
                    <input type="text" id="custom-room-id" placeholder="Oda Kodu (boş = rastgele)">
                    <select id="max-players-select">
                        <option value="8" selected>8 Kişi</option>
                        <option value="10">10 Kişi</option>
                    </select>
                    <button class="btn-main" onclick="confirmCreateRoom()">KUR</button>
                </div>
            </div>
        </section>

        <section id="game-room" class="screen">
            <div class="top-bar">
                <div><span id="room-name-label"></span> <small id="player-status"></small></div>
                <div id="admin-panel"><button onclick="startGame()">BAŞLAT</button></div>
                <div class="media-controls">
                    <button id="mic-btn" onclick="toggleMic()">🎤</button>
                    <button id="spk-btn" onclick="toggleSpk()">🔊</button>
                </div>
            </div>
            <div id="player-grid" class="arena-grid"></div>
            <div class="chat-system">
                <div id="chat-messages"></div>
                <input id="chat-input" onkeydown="if(event.key==='Enter') sendChat()" placeholder="Mesaj...">
                <button onclick="sendChat()">Gönder</button>
            </div>
        </section>
    </div>
    <script src="app.js"></script>
</body>
</html>
