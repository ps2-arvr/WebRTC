/**
 * 自身のWebカメラの映像をlocal_videoに、
 * WebSocketで接続したpeerの映像をcontainer内に動的に生成します 
 */
const localVideo = document.getElementById("local_video");
const container = document.getElementById("container");
 
let localStream = null;
let peerConnections = [];
let remoteVideos = [];
const streamOption = {video: {facingMode: "environment"}, audio: false};
const MAX_CONNECTION_COUNT = 5;
 
// ベンダープレフィックス
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
RTCSessionDescription = window.RTCSessionDescription || window.webkitRTCSessionDescription || window.mozRTCSessionDescription;
RTCIceCandidate = window.RTCIceCandidate || window.webkitRTCIceCandidate || window.mozRTCIceCandidate || window.msRTCIceCandidate;
 
// ボタンを押して自分のWebカメラの映像を映す
async function startVideo() {
    try {
        localStream = await getDeviceStream(streamOption);
        playVideo(localVideo, localStream);
        console.log("start stream video");
    } catch(error) {
        console.log("can't start local video: " + error);
    }
}
// Webカメラの映像を取得
async function getDeviceStream(option) {
    if ("getUserMedia" in navigator.mediaDevices) {
        return await navigator.mediaDevices.getUserMedia(option);
    }
}
// videoタグにstreamを映す
async function playVideo(element, stream) {
    if ("srcObject" in element) {
        element.srcObject = stream;
    } else {
        element.src = window.URL.createObjectURL(stream);
    }
    try {
        await element.play();
    } catch(error) {
        console.log("stream error: " + error);
    }
}
 
// ボタンを押して自分のWebカメラの映像を止める
function stopVideo() {
    stopLocalStream(localStream);
    localStream = null;
    console.log("video stream stop");
}
// 映像を取得することをやめる
function stopLocalStream(stream) {
    let tracks = stream.getTracks();
    for (let track of tracks) {
        track.stop();
    }
}
 
/**
 * シグナリングサーバーを経由してSDPと呼ばれる自分のWebカメラや
 * ブラウザの情報を同room内で交換します
 * 
 * WebRTCでは、このSDPを受け取って相手のWebカメラ映像を取得したい！という
 * 要望を出すことを「Offer」といい、Offerに対して、自分のSDP渡すから
 * あなたのも頂戴！という要望を出すことを「Answer」という
 */
//const url = "https://192.168.3.16:3000/";
const url = "https://e7e84a26.ngrok.io/";
const socket = io.connect(url, {secure: true});
let room = "testRoom";
 
// シグナリングサーバー接続成功時
socket.on("connect", function(evt) {
    console.log("signaling server connected\r\nmy id: " + socket.id);
    socket.emit("enter", room);
    console.log("enter room: " + room);
});
 
/**
 * まずはボタンをお押すことで
 * 同roomのpeerに対してofferを送ってほしいという要望を出します
 */
function connect() {
    if (localStream && peerConnections.length < MAX_CONNECTION_COUNT) {
        socket.emit("message", {type: "call me"});
        console.log("send call me by: " + socket.id);
    }
}
// 各種メッセージの処理
socket.on("message", function(message) {
    let fromId = message.from;
    console.log("message by " + fromId + ": " + message.type);
 
    switch (message.type) {
        // Offer要請を受けたとき
        case "call me":
            if (localStream && peerConnections.length < MAX_CONNECTION_COUNT) {
                makeOffer(fromId);
                console.log("send offer from: " + socket.id + " to: " + fromId);
            }
            break;
        // Offerを受けたらSDPを生成してAnswerを送る
        case "offer":
            let offer = new RTCSessionDescription(message);
            setOffer(fromId, offer);
            console.log("send answer from: " + socket.id + " to: " + fromId);
            break;
        case "answer":
            let answer = new RTCSessionDescription(message);
            setAnswer(fromId, answer);
            break;
        case "candidate":
            let candidate = new RTCIceCandidate(message.ice);
            addCandidate(fromId, candidate);
            break;
        case "bye":
            break;
    }
});
 
/**
 * WebRTCでは自分も相手もポート開放などの特別な操作をせずP2P通信をするという
 * ことを実現しています。本来別のネットワーク同士の通信ではNATにより
 * 互いに相手のグローバルIPアドレスを知ることができないため通信ができません。
 * 
 * そのため、自身のグローバルIPを教えてくれるSTUNサーバーをネットワーク外に用意し、
 * ICEという手法で接続できそうなaddr:portを総当たりで通信を試みます。
 * この時の候補を「candidate」と呼びます
 * 
 * それでも通信ができなかった場合、TURNサーバーを経由して通信をします。
 */
function prepareNewConnection(id) {
    // 今回は同ネットワーク内なのでSTUN/TURNサーバーは使いません
    let pc_config = {"iceServers": [/* 本来ここに stun:アドレス のように設定する */]};
    let peer = new RTCPeerConnection(pc_config);
 
    // SDPの受け渡し(Offer/Answer)と同時に以下のイベントが発火しcandidateを送りあう
    peer.onicecandidate = evt => {
        if (evt.candidate) {
            sendCandidate(id, evt.candidate);
            console.log("send candidate from: " + socket.id + " to: " + id);
        }
    }
 
 
    // リモートPeerからトラックを受け取り映像を流す
    peer.ontrack = evt => {
        let stream = evt.streams[0];
        if (!remoteVideos[id]) {
            createVideo(id, stream);
        }
    }
 
    // Offer/Answerのセット終了後addSすることでonicecandidateが発火
    if (localStream) {
        console.log("adding local stream");
        localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    }
 
    return peer;
}
// SDPを指定idに送信する
function sendSdp(id, sessionDescription) {
    let message = {type: sessionDescription.type, sdp: sessionDescription.sdp, sendto: id};
    console.log("send sdp to: " + id);
    console.log("message: "+JSON.stringify(message));
    socket.emit("message", message);
}
 
// Offerを作成、SDPをCallMeしたpeerに送信
async function makeOffer(id) {
    console.log("makeOffer: " + id);
    peer = prepareNewConnection(id);
    peerConnections[id] = peer;
 
    let offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
 
    sendSdp(id, peer.localDescription);
}
 
// 受け取ったOfferをセットし、Answerを送る
async function setOffer(id, sessionDescription) {
    let peer = prepareNewConnection(id);
    peerConnections[id] = peer;
 
    await peer.setRemoteDescription(sessionDescription);
    makeAnswer(id);
}
// Answerを作成、SDPをOfferを送信したpeerに送信
async function makeAnswer(id) {
    let peer = peerConnections[id];
    if (peer) {
        let answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
 
        sendSdp(id, peer.localDescription);
    }
}
 
// 受け取ったAnswerをセット
async function setAnswer(id, sessionDescription) {
    let peer = peerConnections[id];
    if (peer) {
        await peer.setRemoteDescription(sessionDescription);
    }
}
 
// candidateを送る
function sendCandidate(id, candidate) {
    let message = {type: "candidate", ice: candidate};
 
    if (peerConnections[id]) {
        socket.emit("message", message);
    }
}
// 送られたcandidateをセット
function addCandidate(id, candidate) {
    if (peerConnections[id]) {
        let peer = peerConnections[id];
        peer.addIceCandidate(candidate);
        // このタイミングでonicecandidateが発火するので送り返す
    }
}
 
// ICEでP2Pができたらリモート映像を出力する
function createVideo(id, stream) {
    let video = document.createElement("video");
    video.id = "remote_" + id;
    container.appendChild(video);
    remoteVideos[id] = video;
 
    playVideo(video, stream);
}

startVideo();
sleep(2000);
connect();
