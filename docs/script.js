/**
 * ���g��Web�J�����̉f����local_video�ɁA
 * WebSocket�Őڑ�����peer�̉f����container���ɓ��I�ɐ������܂� 
 */
const localVideo = document.getElementById("local_video");
const container = document.getElementById("container");
 
let localStream = null;
let peerConnections = [];
let remoteVideos = [];
const streamOption = {video: {facingMode: "environment"}, audio: false};
const MAX_CONNECTION_COUNT = 5;
 
// �x���_�[�v���t�B�b�N�X
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
RTCSessionDescription = window.RTCSessionDescription || window.webkitRTCSessionDescription || window.mozRTCSessionDescription;
RTCIceCandidate = window.RTCIceCandidate || window.webkitRTCIceCandidate || window.mozRTCIceCandidate || window.msRTCIceCandidate;
 
// �{�^���������Ď�����Web�J�����̉f�����f��
async function startVideo() {
    try {
        localStream = await getDeviceStream(streamOption);
        playVideo(localVideo, localStream);
        console.log("start stream video");
    } catch(error) {
        console.log("can't start local video: " + error);
    }
}
// Web�J�����̉f�����擾
async function getDeviceStream(option) {
    if ("getUserMedia" in navigator.mediaDevices) {
        return await navigator.mediaDevices.getUserMedia(option);
    }
}
// video�^�O��stream���f��
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
 
// �{�^���������Ď�����Web�J�����̉f�����~�߂�
function stopVideo() {
    stopLocalStream(localStream);
    localStream = null;
    console.log("video stream stop");
}
// �f�����擾���邱�Ƃ���߂�
function stopLocalStream(stream) {
    let tracks = stream.getTracks();
    for (let track of tracks) {
        track.stop();
    }
}
 
/**
 * �V�O�i�����O�T�[�o�[���o�R����SDP�ƌĂ΂�鎩����Web�J������
 * �u���E�U�̏���room���Ō������܂�
 * 
 * WebRTC�ł́A����SDP���󂯎���đ����Web�J�����f�����擾�������I�Ƃ���
 * �v�]���o�����Ƃ��uOffer�v�Ƃ����AOffer�ɑ΂��āA������SDP�n������
 * ���Ȃ��̂����ՁI�Ƃ����v�]���o�����Ƃ��uAnswer�v�Ƃ���
 */
//const url = "https://192.168.3.16:3000/";
const url = "https://e7e84a26.ngrok.io/";
const socket = io.connect(url, {secure: true});
let room = "testRoom";
 
// �V�O�i�����O�T�[�o�[�ڑ�������
socket.on("connect", function(evt) {
    console.log("signaling server connected\r\nmy id: " + socket.id);
    socket.emit("enter", room);
    console.log("enter room: " + room);
});
 
/**
 * �܂��̓{�^�������������Ƃ�
 * ��room��peer�ɑ΂���offer�𑗂��Ăق����Ƃ����v�]���o���܂�
 */
function connect() {
    if (localStream && peerConnections.length < MAX_CONNECTION_COUNT) {
        socket.emit("message", {type: "call me"});
        console.log("send call me by: " + socket.id);
    }
}
// �e�탁�b�Z�[�W�̏���
socket.on("message", function(message) {
    let fromId = message.from;
    console.log("message by " + fromId + ": " + message.type);
 
    switch (message.type) {
        // Offer�v�����󂯂��Ƃ�
        case "call me":
            if (localStream && peerConnections.length < MAX_CONNECTION_COUNT) {
                makeOffer(fromId);
                console.log("send offer from: " + socket.id + " to: " + fromId);
            }
            break;
        // Offer���󂯂���SDP�𐶐�����Answer�𑗂�
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
 * WebRTC�ł͎�����������|�[�g�J���Ȃǂ̓��ʂȑ��������P2P�ʐM������Ƃ���
 * ���Ƃ��������Ă��܂��B�{���ʂ̃l�b�g���[�N���m�̒ʐM�ł�NAT�ɂ��
 * �݂��ɑ���̃O���[�o��IP�A�h���X��m�邱�Ƃ��ł��Ȃ����ߒʐM���ł��܂���B
 * 
 * ���̂��߁A���g�̃O���[�o��IP�������Ă����STUN�T�[�o�[���l�b�g���[�N�O�ɗp�ӂ��A
 * ICE�Ƃ�����@�Őڑ��ł�������addr:port�𑍓�����ŒʐM�����݂܂��B
 * ���̎��̌����ucandidate�v�ƌĂт܂�
 * 
 * ����ł��ʐM���ł��Ȃ������ꍇ�ATURN�T�[�o�[���o�R���ĒʐM�����܂��B
 */
function prepareNewConnection(id) {
    // ����͓��l�b�g���[�N���Ȃ̂�STUN/TURN�T�[�o�[�͎g���܂���
    let pc_config = {"iceServers": [/* �{�������� stun:�A�h���X �̂悤�ɐݒ肷�� */]};
    let peer = new RTCPeerConnection(pc_config);
 
    // SDP�̎󂯓n��(Offer/Answer)�Ɠ����Ɉȉ��̃C�x���g�����΂�candidate�𑗂肠��
    peer.onicecandidate = evt => {
        if (evt.candidate) {
            sendCandidate(id, evt.candidate);
            console.log("send candidate from: " + socket.id + " to: " + id);
        }
    }
 
 
    // �����[�gPeer����g���b�N���󂯎��f���𗬂�
    peer.ontrack = evt => {
        let stream = evt.streams[0];
        if (!remoteVideos[id]) {
            createVideo(id, stream);
        }
    }
 
    // Offer/Answer�̃Z�b�g�I����addS���邱�Ƃ�onicecandidate������
    if (localStream) {
        console.log("adding local stream");
        localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    }
 
    return peer;
}
// SDP���w��id�ɑ��M����
function sendSdp(id, sessionDescription) {
    let message = {type: sessionDescription.type, sdp: sessionDescription.sdp, sendto: id};
    console.log("send sdp to: " + id);
    console.log("message: "+JSON.stringify(message));
    socket.emit("message", message);
}
 
// Offer���쐬�ASDP��CallMe����peer�ɑ��M
async function makeOffer(id) {
    console.log("makeOffer: " + id);
    peer = prepareNewConnection(id);
    peerConnections[id] = peer;
 
    let offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
 
    sendSdp(id, peer.localDescription);
}
 
// �󂯎����Offer���Z�b�g���AAnswer�𑗂�
async function setOffer(id, sessionDescription) {
    let peer = prepareNewConnection(id);
    peerConnections[id] = peer;
 
    await peer.setRemoteDescription(sessionDescription);
    makeAnswer(id);
}
// Answer���쐬�ASDP��Offer�𑗐M����peer�ɑ��M
async function makeAnswer(id) {
    let peer = peerConnections[id];
    if (peer) {
        let answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
 
        sendSdp(id, peer.localDescription);
    }
}
 
// �󂯎����Answer���Z�b�g
async function setAnswer(id, sessionDescription) {
    let peer = peerConnections[id];
    if (peer) {
        await peer.setRemoteDescription(sessionDescription);
    }
}
 
// candidate�𑗂�
function sendCandidate(id, candidate) {
    let message = {type: "candidate", ice: candidate};
 
    if (peerConnections[id]) {
        socket.emit("message", message);
    }
}
// ����ꂽcandidate���Z�b�g
function addCandidate(id, candidate) {
    if (peerConnections[id]) {
        let peer = peerConnections[id];
        peer.addIceCandidate(candidate);
        // ���̃^�C�~���O��onicecandidate�����΂���̂ő���Ԃ�
    }
}
 
// ICE��P2P���ł����烊���[�g�f�����o�͂���
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
