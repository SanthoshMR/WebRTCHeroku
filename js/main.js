// Clean up function.
window.onbeforeunload = function(e) {
	hangup();
}

// Data channel information.
var sendChannel, receiveChannel,
	sendButton = document.getElementById("sendButton"),
	sendTextarea = document.getElementById("dataChannelSend"),
	receiveTextarea = document.getElementById("dataChannelReceive");

// Video elements.
var localVideo = document.querySelector('#localVideo'),
	remoteVideo = document.querySelector('#remoteVideo');

// Handler associated with Send button
sendButton.onclick = sendData;

// Flags
var isChannelReady = false,
	isInitiator = false,
	isStarted = false;

// Streams
var localStream,
	remoteStream,
	pc;

// ICE servers config.
var iceConfig = webrtcDetectedBrowser === "firefox" ? {
	'iceServers': [{
		'url': 'stun:23.21.150.121'
	}]
} : {
	'iceServers': [{
		'url': 'stun:stun.l.google.com:19302'
	}]
};

var dataConstraints = {
	"optional": [{
		"DtlsSrtpKeyAgreement": true
	}]
};

var sdpConstraints = {};

// Prompt user for room name.
var room = prompt("Enter room name: ");

// Connect to signaling server.
var socket = io.connect("http://localhost:2014");

// Send create or join to signaling server.
if (room !== '') {
	console.log('Create or join room', room);
	socket.emit('create or join', room);
}

// Set user media constraints.
var constraints = {
	video: {
		mandatory: {
			maxWidth: 640,
			maxHeight: 360
		}
	},
	audio: true
};

// getUserMedia() handlers
function handleUserMedia(stream) {
	localStream = stream;
	attachMediaStream(localVideo, stream);
	console.log('Adding local stream.');
	sendMessage('got user media');
}

function handleUserMediaError(error) {
	console.log('navigator.getUserMedia error: ', error);
}

// Server mediated message exchanging
// Server --> Client
// Handle 'created' message coming back from server: 
// this peer is the initiator
socket.on('created', function(room) {
	console.log('Created room ' + room);
	isInitiator = true;
	getUserMedia(constraints, handleUserMedia, handleUserMediaError);
	console.log('Getting user media with constraints', constraints);
	checkAndStart();
});

// Handle 'full' message coming back from server: 
// this peer arrived too late :-(
socket.on('full', function(room) {
	console.log('Room ' + room + ' is full');
});

// Handle 'remotePeerJoining' message coming back from server: 
// another peer is joining the channel. 
socket.on('remotePeerJoining', function(room) {
	console.log('Another peer made a request to join room ' + room);
	console.log('This peer is the initiator of room ' + room + '!');
	isChannelReady = true;
});

// Handle 'joined' message coming back from server: 
// this is the second peer joining the channel. 
socket.on('client:joined', function(room) {
	console.log('This peer has joined room ' + room);
	isChannelReady = true;
	getUserMedia(constraints, handleUserMedia, handleUserMediaError);
	console.log('Getting user media with constraints', constraints);
});

// Server sent log messages.
socket.on('log', function(array) {
	console.log.apply(console, array);
});

// Receive message from the other peer.
socket.on('message', function(message) {
	console.log('Received message:', message);
	if (message === 'got user media') {
		checkAndStart();
	} else if (message.type === 'offer') {
		if (!isInitiator && !isStarted) {
			checkAndStart();
		}
		pc.setRemoteDescription(new RTCSessionDescription(message));
		doAnswer();
	} else if (message.type === 'answer' && isStarted) {
		pc.setRemoteDescription(new RTCSessionDescription(message));
	} else if (message.type === 'candidate' && isStarted) {
		var candidate = new RTCIceCandidate({
			sdpMLineIndex: message.label,
			candidate: message.candidate
		});
		pc.addIceCandidate(candidate);
	} else if (message === 'bye' && isStarted) {
		handleRemoteHangup();
	}
});

// Client --> Server
// Send message to the other peer.
function sendMessage(message) {
	console.log('Sending message: ', message);
	socket.emit('message', {
		message: message,
		channel: room
	});
}

// Channel negotiation trigger
function checkAndStart() {
	if (!isStarted && typeof localStream != 'undefined' && isChannelReady) {
		createPeerConnection();
		isStarted = true;
		if (isInitiator) {
			doCall();
		}
	}
}

function createPeerConnection() {
	try {
		pc = new RTCPeerConnection(iceConfig, dataConstraints);
		pc.addStream(localStream);
		pc.onicecandidate = handleIceCandidate;
		console.log('Created RTCPeerConnnection with:\n  config: \'' + JSON.stringify(iceConfig) + '\';\n  constraints: \'' + JSON.stringify(dataConstraints) + '\'.');
	} catch (e) {
		console.log('Failed to create PeerConnection, exception: ' + e.message);
		alert('Cannot create RTCPeerConnection object.');
		return;
	}
	pc.onaddstream = handleRemoteStreamAdded;
	pc.onremovestream = handleRemoteStreamRemoved;
	if (isInitiator) {
		try {
			// Create a reliable data channel
			sendChannel = pc.createDataChannel("sendDataChannel", {
				reliable: true
			});
			trace('Created send data channel');
		} catch (e) {
			alert('Failed to create data channel. ');
			trace('createDataChannel() failed with exception: ' + e.message);
		}
		sendChannel.onopen = handleSendChannelStateChange;
		sendChannel.onmessage = handleMessage;
		sendChannel.onclose = handleSendChannelStateChange;
	} else { // Joiner
		pc.ondatachannel = gotReceiveChannel;
	}
}

// Data channel management
function sendData() {
	var data = sendTextarea.value;
	sendTextarea.value = "";
	if (isInitiator) {
		sendChannel.send(data);
	} else {
		receiveChannel.send(data);
	}
	trace('Sent data: ' + data);
}

function gotReceiveChannel(event) {
	trace('Receive Channel Callback');
	receiveChannel = event.channel;
	receiveChannel.onmessage = handleMessage;
	receiveChannel.onopen = handleReceiveChannelStateChange;
	receiveChannel.onclose = handleReceiveChannelStateChange;
}

function handleMessage(event) {
	trace('Received message: ' + event.data);
	receiveTextarea.value += event.data + '\n';
}

function handleSendChannelStateChange() {
	var readyState = sendChannel.readyState;
	trace('Send channel state is: ' + readyState);
	if (readyState == "open") {
		dataChannelSend.disabled = false;
		dataChannelSend.focus();
		dataChannelSend.placeholder = "";
		sendButton.disabled = false;
	} else {
		dataChannelSend.disabled = true;
		sendButton.disabled = true;
	}
}

function handleReceiveChannelStateChange() {
	var readyState = receiveChannel.readyState;
	trace('Receive channel state is: ' + readyState);
	if (readyState == "open") {
		dataChannelSend.disabled = false;
		dataChannelSend.focus();
		dataChannelSend.placeholder = "";
		sendButton.disabled = false;
	} else {
		dataChannelSend.disabled = true;
		sendButton.disabled = true;
	}
}

// ICE candidates management
function handleIceCandidate(event) {
	console.log('handleIceCandidate event: ', event);
	if (event.candidate) {
		sendMessage({
			type: 'candidate',
			label: event.candidate.sdpMLineIndex,
			id: event.candidate.sdpMid,
			candidate: event.candidate.candidate
		});
	} else {
		console.log('End of candidates.');
	}
}

// Create offer
function doCall() {
	console.log('Creating Offer...');
	pc.createOffer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}

// Signaling error handler
function onSignalingError(error) {
	console.log('Failed to create signaling message : ' + error.name);
}

// Create answer
function doAnswer() {
	console.log('Sending answer to peer.');
	pc.createAnswer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}

// Success handler for createOffer and createAnswer
function setLocalAndSendMessage(sessionDescription) {
	pc.setLocalDescription(sessionDescription);
	sendMessage(sessionDescription);
}

// Remote stream handlers
function handleRemoteStreamAdded(event) {
	console.log('Remote stream added.');
	attachMediaStream(remoteVideo, event.stream);
	console.log('Remote stream attached!!.');
	remoteStream = event.stream;
}

function handleRemoteStreamRemoved(event) {
	console.log('Remote stream removed. Event: ', event);
}

function hangup() {
	console.log('Hanging up.');
	stop();
	sendMessage('bye');
}

function handleRemoteHangup() {
	console.log('Session terminated.');
	stop();
	isInitiator = false;
}

function stop() {
	isStarted = false;
	if (sendChannel) sendChannel.close();
	if (receiveChannel) receiveChannel.close();
	if (pc) pc.close();
	pc = null;
	sendButton.disabled = true;
}
