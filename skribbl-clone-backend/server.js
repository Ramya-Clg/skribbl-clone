// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

/*
  In‑memory room state structure:
  rooms = {
    roomId: {
      players: { socketId: { nickname, score, isSpectator } },
      playerOrder: [socketId, socketId, ...],
      currentTurnIndex: 0,
      currentWord: null,
      difficulty: 'easy'|'medium'|'hard',
      candidateWords: [], // for word selection
      timerInterval: null,
      round: 0,
      totalRounds: 5,
      skipVotes: Set(),
      hintTimers: [],
      drawerDrew: false,
      language: 'en',
      isPublic: false,
    },
    ...
  }
*/
const rooms = {};

// Global leaderboard (in‑memory)
const globalLeaderboard = {};

// Word lists by difficulty
const easyWords = ['apple', 'cat', 'dog'];
const mediumWords = ['elephant', 'guitar', 'monkey'];
const hardWords = ['hippopotamus', 'xylophone', 'pterodactyl'];

function getRandomWords(difficulty) {
    let words;
    if (difficulty === 'easy') {
        words = easyWords;
    } else if (difficulty === 'medium') {
        words = mediumWords;
    } else if (difficulty === 'hard') {
        words = hardWords;
    } else {
        words = easyWords;
    }
    // Shuffle and return three candidates.
    return words.sort(() => 0.5 - Math.random()).slice(0, 3);
}

function createRoom(roomId, difficulty = 'easy', totalRounds = 5, language = 'en', isPublic = false) {
    rooms[roomId] = {
        players: {},
        playerOrder: [],
        currentTurnIndex: 0,
        currentWord: null,
        difficulty,
        candidateWords: [],
        timerInterval: null,
        round: 0,
        totalRounds,
        skipVotes: new Set(),
        hintTimers: [],
        drawerDrew: false,
        language,
        isPublic,
    };
}

// Start a new round: sends candidate words to the drawer, starts the timer, and schedules hints.
function startRound(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // Ensure at least 2 active (non‑spectator) players.
    const activePlayers = Object.values(room.players).filter(player => !player.isSpectator);
    if (activePlayers.length < 2) {
        io.to(roomId).emit('message', { user: 'admin', text: 'Need at least 2 active players to start a round.' });
        return;
    }

    room.drawerDrew = false;
    room.skipVotes.clear();
    room.round++;
    const drawerId = room.playerOrder[room.currentTurnIndex];
    // Send three candidate words to the drawer.
    room.candidateWords = getRandomWords(room.difficulty);
    io.to(drawerId).emit('wordCandidates', room.candidateWords);

    // Inform everyone about the turn.
    io.to(roomId).emit('turn', {
        drawer: room.players[drawerId].nickname,
        duration: 60,
        round: room.round,
        totalRounds: room.totalRounds,
    });

    // Start the 60-second countdown.
    let remaining = 60;
    room.timerInterval = setInterval(() => {
        remaining--;
        io.to(roomId).emit('timer', remaining);
        if (remaining <= 0) {
            clearInterval(room.timerInterval);
            endRound(roomId);
        }
    }, 1000);

    // Warn if the drawer hasn’t drawn within 10 seconds.
    setTimeout(() => {
        if (!room.drawerDrew) {
            io.to(drawerId).emit('warning', 'Please start drawing!');
        }
    }, 10000);

    // Schedule hints.
    room.hintTimers.push(setTimeout(() => {
        if (room.currentWord) {
            const firstLetter = room.currentWord.charAt(0);
            const lastLetter = room.currentWord.charAt(room.currentWord.length - 1);
            io.to(roomId).emit('hint', { type: 'firstLast', hint: `${firstLetter}___${lastLetter}` });
        }
    }, 15000));

    room.hintTimers.push(setTimeout(() => {
        if (room.currentWord && room.currentWord.length > 2) {
            const idx = Math.floor(Math.random() * (room.currentWord.length - 2)) + 1;
            const letter = room.currentWord.charAt(idx);
            io.to(roomId).emit('hint', { type: 'random', index: idx, letter });
        }
    }, 30000));
}

// End the current round. If final round reached, update global leaderboard and announce winner.
function endRound(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    clearInterval(room.timerInterval);
    room.hintTimers.forEach(timer => clearTimeout(timer));
    room.hintTimers = [];
    room.drawerDrew = false;

    io.to(roomId).emit('message', { user: 'admin', text: `Round ended! The word was: ${room.currentWord || 'unknown'}` });
    io.to(roomId).emit('clearBoard');

    // If final round, update global leaderboard and announce final winner.
    if (room.round >= room.totalRounds) {
        for (const id in room.players) {
            const player = room.players[id];
            if (!player.isSpectator) {
                if (!globalLeaderboard[player.nickname] || globalLeaderboard[player.nickname] < player.score) {
                    globalLeaderboard[player.nickname] = player.score;
                }
            }
        }
        io.to(roomId).emit('finalLeaderboard', room.players);
        let winner = Object.values(room.players).reduce((max, player) =>
            player.score > max.score ? player : max, { score: 0 });
        // Emit a winner announcement (to be shown with a flashing effect on the client)
        io.to(roomId).emit('winnerAnnouncement', { winner: winner.nickname });
        io.to(roomId).emit('message', { user: 'admin', text: `Winner: ${winner.nickname}!` });
        return;
    }

    // Rotate turn and start the next round after a delay.
    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.playerOrder.length;
    setTimeout(() => {
        startRound(roomId);
    }, 5000);
}

// Socket.IO event handling.
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Create a new room.
    socket.on('createRoom', ({ roomId, nickname, difficulty, totalRounds, isSpectator, language, isPublic }) => {
        if (rooms[roomId]) {
            socket.emit('error', 'Room already exists!');
            return;
        }
        createRoom(roomId, difficulty, totalRounds, language, isPublic);
        rooms[roomId].players[socket.id] = { nickname, score: 0, isSpectator: !!isSpectator };
        rooms[roomId].playerOrder.push(socket.id);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.nickname = nickname;
        io.to(roomId).emit('message', { user: 'admin', text: `${nickname} has created the room.` });
    });

    // Join an existing room.
    socket.on('joinRoom', ({ roomId, nickname, isSpectator }) => {
        if (!rooms[roomId]) {
            socket.emit('error', 'Room does not exist!');
            return;
        }
        rooms[roomId].players[socket.id] = { nickname, score: 0, isSpectator: !!isSpectator };
        rooms[roomId].playerOrder.push(socket.id);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.nickname = nickname;
        io.to(roomId).emit('message', { user: 'admin', text: `${nickname} has joined the room.` });
    });

    // Drawer selects a word.
    socket.on('selectWord', (selectedWord) => {
        const roomId = socket.roomId;
        const room = rooms[roomId];
        if (room && socket.id === room.playerOrder[room.currentTurnIndex]) {
            room.currentWord = selectedWord;
            io.to(roomId).emit('message', { user: 'admin', text: `${socket.nickname} selected a word!` });
        }
    });

    // Relay drawing events (with color and brushSize).
    socket.on('drawing', (data) => {
        const roomId = socket.roomId;
        const room = rooms[roomId];
        if (!room) return;
        if (socket.id === room.playerOrder[room.currentTurnIndex]) {
            room.drawerDrew = true;
        }
        socket.broadcast.to(roomId).emit('drawing', data);
    });

    // Handle player guesses.
    socket.on('guess', (guess) => {
        const roomId = socket.roomId;
        const room = rooms[roomId];
        if (!room) return;
        const drawerId = room.playerOrder[room.currentTurnIndex];
        if (room.currentWord &&
            guess.toLowerCase() === room.currentWord.toLowerCase() &&
            socket.id !== drawerId) {
            // Award points based on difficulty.
            const points = room.difficulty === 'hard' ? 15 : room.difficulty === 'medium' ? 10 : 5;
            room.players[socket.id].score += points;
            room.players[drawerId].score += 5;
            io.to(roomId).emit('message', { user: 'admin', text: `${socket.nickname} guessed correctly!` });
            io.to(roomId).emit('scoreUpdate', room.players);
            clearInterval(room.timerInterval);
            endRound(roomId);
        } else {
            io.to(roomId).emit('guess', { user: socket.nickname, guess });
        }
    });

    // Handle skip round vote.
    socket.on('voteSkip', () => {
        const roomId = socket.roomId;
        const room = rooms[roomId];
        if (!room) return;
        room.skipVotes.add(socket.id);
        const totalActive = room.playerOrder.filter(id => !room.players[id].isSpectator).length;
        if (room.skipVotes.size >= Math.ceil(totalActive * 0.6)) {
            io.to(roomId).emit('message', { user: 'admin', text: 'Round skipped by vote!' });
            clearInterval(room.timerInterval);
            endRound(roomId);
        }
    });

    // On disconnect.
    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            const nickname = socket.nickname;
            delete room.players[socket.id];
            room.playerOrder = room.playerOrder.filter(id => id !== socket.id);
            io.to(roomId).emit('message', { user: 'admin', text: `${nickname} has left the room.` });
            if (room.playerOrder.length === 0) {
                delete rooms[roomId];
            }
        }
        // In server.js, inside io.on('connection', (socket) => { ... })
        socket.on('voiceJoin', ({ roomId }) => {
            // Notify all clients in the room (except the joining one) that a new user joined for voice chat.
            socket.broadcast.to(roomId).emit('voiceUserJoined', { socketId: socket.id });
        });

        // Forward voice signal data to everyone else in the room.
        socket.on('voiceSignal', (data) => {
            // data should contain: { roomId, signal }
            // Broadcast the voice signal to all other clients in the room.
            socket.broadcast.to(data.roomId).emit('voiceSignal', { signal: data.signal, from: socket.id });
        });

        console.log('Client disconnected:', socket.id);
    });
});

// Endpoint to list public rooms.
app.get('/publicRooms', (req, res) => {
    const publicRooms = Object.entries(rooms)
        .filter(([id, room]) => room.isPublic)
        .map(([id, room]) => ({ roomId: id, playersCount: room.playerOrder.length }));
    res.json(publicRooms);
});

// Endpoint to retrieve the global leaderboard.
app.get('/leaderboard', (req, res) => {
    res.json(globalLeaderboard);
});

app.get('/', (req, res) => {
    res.send('Server is running');
});
