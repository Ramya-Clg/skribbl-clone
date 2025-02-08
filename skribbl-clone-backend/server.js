// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// In‑memory storage for rooms and game state
const rooms = {};

/*
  Room structure example:
  rooms = {
    roomId: {
      players: { socketId: { nickname, score } },
      playerOrder: [socketId, socketId, ...],
      currentTurnIndex: 0,
      currentWord: null,
      timer: null,
      isRoundActive: false,
    },
    ...
  }
*/

// List of words for the game
const words = ['apple', 'banana', 'cat', 'dog', 'elephant', 'flower', 'guitar'];
const getRandomWord = () => words[Math.floor(Math.random() * words.length)];

// Create a new room in memory
const createRoom = (roomId) => {
  rooms[roomId] = {
    players: {},
    playerOrder: [],
    currentTurnIndex: 0,
    currentWord: null,
    timer: null,
    isRoundActive: false,
  };
};

// Start a new round in the given room
const startRound = (roomId) => {
  const room = rooms[roomId];
  if (!room) return;
  if (room.playerOrder.length < 2) {
    io.to(roomId).emit('message', {
      user: 'admin',
      text: 'Need at least 2 players to start the round.',
    });
    return;
  }
  room.isRoundActive = true;
  room.currentWord = getRandomWord();

  // Determine who is the drawer
  const drawerId = room.playerOrder[room.currentTurnIndex];
  // Send the word privately to the drawer
  io.to(drawerId).emit('word', room.currentWord);
  // Notify everyone in the room about the current turn and round duration
  io.to(roomId).emit('turn', {
    drawer: room.players[drawerId].nickname,
    duration: 60,
  });

  // Start a 60‑second timer for the round
  room.timer = setTimeout(() => {
    endRound(roomId);
  }, 60000);
};

// End the current round and notify players
const endRound = (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    room.isRoundActive = false;
  
    // Inform everyone that the round has ended
    io.to(roomId).emit('message', {
      user: 'admin',
      text: `Round ended! The word was: ${room.currentWord}`,
    });
  
    // Emit a new event to clear the drawing board for all players
    io.to(roomId).emit('clearBoard');
  
    // Rotate turn for the next round
    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.playerOrder.length;
    room.currentWord = null;
  
    // Optionally, start the next round after a short delay (e.g., 5 seconds)
    setTimeout(() => {
      startRound(roomId);
    }, 5000);
  };
  

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // --- ROOM MANAGEMENT & USER MANAGEMENT ---

  // Create a new room
  socket.on('createRoom', ({ roomId, nickname }) => {
    if (rooms[roomId]) {
      socket.emit('error', 'Room already exists!');
      return;
    }
    createRoom(roomId);
    // Add player to room
    rooms[roomId].players[socket.id] = { nickname, score: 0 };
    rooms[roomId].playerOrder.push(socket.id);
    socket.join(roomId);
    // Save room and nickname in socket for later use
    socket.roomId = roomId;
    socket.nickname = nickname;
    io.to(roomId).emit('message', {
      user: 'admin',
      text: `${nickname} has created the room.`,
    });
  });

  // Join an existing room
  socket.on('joinRoom', ({ roomId, nickname }) => {
    if (!rooms[roomId]) {
      socket.emit('error', 'Room does not exist!');
      return;
    }
    rooms[roomId].players[socket.id] = { nickname, score: 0 };
    rooms[roomId].playerOrder.push(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.nickname = nickname;
    io.to(roomId).emit('message', {
      user: 'admin',
      text: `${nickname} has joined the room.`,
    });
  });

  // Start the game (should be initiated by the room host)
  socket.on('startGame', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    startRound(roomId);
  });

  // --- DRAWING & GAME PLAY EVENTS ---

  // Relay drawing data to all other clients in the room
  socket.on('drawing', (data) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    socket.broadcast.to(roomId).emit('drawing', data);
  });

  // Handle player guesses
  socket.on('guess', (guess) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    // Identify the drawer for this round
    const drawerId = room.playerOrder[room.currentTurnIndex];
    // Only check guesses if a round is active and the guesser isn’t the drawer
    if (
      room.isRoundActive &&
      guess.toLowerCase() === room.currentWord.toLowerCase() &&
      socket.id !== drawerId
    ) {
      // Award points: 10 for the guesser, 5 for the drawer
      room.players[socket.id].score += 10;
      room.players[drawerId].score += 5;

      io.to(roomId).emit('message', {
        user: 'admin',
        text: `${socket.nickname} guessed the word correctly!`,
      });
      // Send updated scores to everyone in the room
      io.to(roomId).emit('scoreUpdate', room.players);

      // End the round early if a correct guess is received
      clearTimeout(room.timer);
      endRound(roomId);
    } else {
      // Broadcast the guess as a chat message
      io.to(roomId).emit('guess', { user: socket.nickname, guess });
    }
  });

  // --- HANDLE DISCONNECTS ---
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      const nickname = socket.nickname;
      // Remove the player from the room
      delete room.players[socket.id];
      room.playerOrder = room.playerOrder.filter((id) => id !== socket.id);
      io.to(roomId).emit('message', {
        user: 'admin',
        text: `${nickname} has left the room.`,
      });
      // If the room is empty, delete it from memory
      if (room.playerOrder.length === 0) {
        delete rooms[roomId];
      }
    }
    console.log('Client disconnected:', socket.id);
  });
});

// A simple test route (optional)
app.get('/', (req, res) => {
  res.send('Server is running');
});
