const express = require('express');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const twilio = require('twilio');

const PORT = process.env.PORT || 5002;

const app = express();

const server = http.createServer(app);

app.use(cors());

let connectedUsers = [];
let rooms = [];
let messageList = [];

// create route to check if room exists
app.get('/api/room-exists/:roomId',(req,res) => {
    const { roomId } = req.params;
    const room = rooms.find(room => room.id === roomId);

    if(room){
        // send response that room exists
        if(room.connectedUsers.length > 3){
            return res.json({ roomExists: true, full: true });
        }else{
            return res.json({ roomExists: true, full: false })
        }
    }else{
        // send response that room does not exists
        return res.json({ roomExists: false })
    }
});

const io = require('socket.io')(server, {
    cors: {
        origin: '*',
        methods: ['GET','POST'],
    }
});

io.on('connection',(socket) => {
    console.log(`user connected ${socket.id}`);

    socket.on('create-new-room', (data) => {
        createNewRoomHandler(data, socket)
    });

    socket.on('join-room', (data) => {
        joinRoomHandler(data, socket)
    });

    socket.on('send-message', (data) => {
        sendMessageHandler(data, socket)
    });

    socket.on('disconnect', () => {
        disconnectHandler(socket)
    });

    socket.on('conn-signal', (data) => {
        signalingHandler(data, socket)
    });

    socket.on('conn-init', (data) => {
        initializeConnectionHandler(data, socket);
    });
})

const createNewRoomHandler = (data, socket) => {
    console.log("host is creating new room")
    const { identity, onlyAudio } = data;

    const roomId = uuidv4();

    // create new user object
    const newUser = {
        identity,
        id: uuidv4(),
        socketId: socket.id,
        roomId,
        onlyAudio,
    };

    // push the user to connectedUsers
    connectedUsers = [ ...connectedUsers, newUser ];

    // create new room
    const newRoom = {
        id: roomId,
        connectedUsers: [newUser],
    };

    // join socket.io room
    socket.join(roomId);
    
    rooms = [ ...rooms, newRoom ];

    // emit to the client which created the room id
    socket.emit('room-id',{roomId});
    
    // emit an event to all users connected
    
    // emit an event about new users which are rightnow in this room
    socket.emit('room-update',{ connectedUsers: newRoom.connectedUsers });
    console.log(rooms)
}

const joinRoomHandler = (data, socket) => {
    const { identity, roomId, onlyAudio } = data;

    const newUser = {
        identity,
        id: uuidv4(),
        socketId: socket.id,
        roomId,
        onlyAudio,
    };
    
    // join room as user which is trying to join room passing room id
    const room = rooms.find(room => room.id === roomId);
    room.connectedUsers = [ ...room.connectedUsers, newUser ];
    
    socket.join(roomId);
    
    // add new user to connectedUsers array
    connectedUsers = [ ...connectedUsers, newUser ];
    console.log(connectedUsers);

    // emit to all users  which are already in this room to prepare peer connection
    room.connectedUsers.forEach((user) => {
        if(user.socketId !== socket.id){
            const data = {
                connUserSocketId: socket.id,
            };

            io.to(user.socketId).emit('conn-prepare', data);
        }
    });

    io.to(roomId).emit("room-update", { connectedUsers: room.connectedUsers });
}

const sendMessageHandler = (data, socket) => {
    const { identity, roomId, message } = data;

    const messageObject = {
        identity,
        socketId: socket.id,
        roomId,
        content: message,
        time: Date.now(),
    };
    
    messageList.push(messageObject);

    io.to(roomId).emit("get-all-messages", { messages: messageList });
}

const disconnectHandler = (socket) => {
    // find if user is registered
    const user = connectedUsers.find((user) => user.socketId === socket.id);
    
    // If yes then remove him from room and connected users array
    if(user){
        // remove user from room in server
        const room = rooms.find(room => room.id === user.roomId);
        
        room.connectedUsers = room.connectedUsers.filter(user => user.socketId !== socket.id);
        
        // leave socket.io room
        socket.leave(user.roomId);
        
        // close room if amount of users will be zero
        if(room.connectedUsers.length > 0){
            // emit to all users which are still in the room that the user is disconnected
            io.to(room.id).emit('user-disconnected', { socketId: socket.id });
            
            // emit event to rest of users which left in the room new connected users in room
            io.to(room.id).emit("room-update", { connectedUsers: room.connectedUsers });
        }else{
            rooms = rooms.filter(r => r.id !== room.id);
        }
    }
}


const signalingHandler = (data, socket) => {
    const { connUserSocketId, signal } = data;

    const signalData = { signal, connUserSocketId: socket.id };
    io.to(connUserSocketId).emit("conn-signal", signalData);
}

const initializeConnectionHandler = (data, socket) => {
    const { connUserSocketId } = data;
    
    const initData = { connUserSocketId: socket.id };
    io.to(connUserSocketId).emit("conn-init", initData);
}

server.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
});
