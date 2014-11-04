var static = require('node-static');
var http = require('http');
var file = new(static.Server)();
var app = http.createServer(function (req, res) {
  file.serve(req, res);
}).listen(2014);


// Ignore this until 3....
var io = require('socket.io').listen(app);

// Get the number of clients in a channel (for socker.io >= 1.0)
function findClientsSocket(channelId, namespace) {
	var res = []
	, ns = io.of(namespace ||"/");    // the default namespace is "/"

	if (ns) {
		for (var id in ns.connected) {
			if(channelId) {
				var index = ns.connected[id].rooms.indexOf(channelId) ;
				if(index !== -1) {
					res.push(ns.connected[id]);
				}
			} else {
				res.push(ns.connected[id]);
			}
		}
	}
	return res;
}

io.sockets.on('connection', function (socket){

	// convenience function to log server messages on the client
	function log(){
		var array = [];
		for (var i = 0; i < arguments.length; i++) {
			array.push(arguments[i]);
		}
		io.sockets.emit('log', array);
		console.log.apply(console, array);
	}

	socket.on('message', function (message) {
		log('Got message:', message.message);
		// for a real app, would be channel only (not broadcast)
		socket.broadcast.to(message.channel).emit('message', message.message);
	});

	socket.on('create or join', function (channel) {
		var numClients = findClientsSocket(channel).length;

		log('channel ' + channel + ' has ' + numClients + ' client(s)');
		log('Request to create or join channel ' + channel);

		if (numClients === 0){
			socket.join(channel);
			socket.emit('created', channel);
		} else if (numClients === 1) {
			io.sockets.in(channel).emit('remotePeerJoining', channel);
			socket.join(channel);
			socket.emit("client:joined", 'broadcast(): client ' + socket.id + ' joined channel ' + channel);
		} else { // max two clients
			socket.emit('full', channel);
		}

	});

	// Handle response messages
	socket.on("response", function(response) {
		log("Got response: ", response.message);
		socket.broadcast.to(response.channel).emit("response", response.message);
	});

	// Handle close messages
	socket.on("Bye", function(channel) {
		socket.broadcast.to(channel).emit("Bye");
		// disconnect the socket.
		socket.disconnect();
	});

	socket.on("Ack", function() {
		log("Got an Ack!");
		socket.disconnect();
	});

});