// src/App.jsx
import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

// Connect to the backend (adjust the URL as needed)
const socket = io('http://localhost:5000');

function App() {
  // Lobby state
  const [joined, setJoined] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');

  // Game state
  const [chatMessages, setChatMessages] = useState([]);
  const [scores, setScores] = useState({});
  const [guess, setGuess] = useState('');
  const [currentDrawer, setCurrentDrawer] = useState('');

  // Canvas refs and drawing state
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });

  // Socket event listeners
  useEffect(() => {
    socket.on('message', (msgData) => {
      setChatMessages((prev) => [...prev, `${msgData.user}: ${msgData.text}`]);
    });

    socket.on('guess', (msgData) => {
      setChatMessages((prev) => [...prev, `${msgData.user}: ${msgData.guess}`]);
    });

    socket.on('scoreUpdate', (scoreData) => {
      setScores(scoreData);
    });

    socket.on('turn', (data) => {
      setCurrentDrawer(data.drawer);
      setChatMessages((prev) => [
        ...prev,
        `It's ${data.drawer}'s turn. You have ${data.duration} seconds.`,
      ]);
    });

    socket.on('drawing', (data) => {
      const context = canvasRef.current.getContext('2d');
      context.beginPath();
      context.moveTo(data.prevX, data.prevY);
      context.lineTo(data.x, data.y);
      context.stroke();
    });

    socket.on('word', (word) => {
      // This event is sent only to the current drawer
      alert(`You are drawing! Your word is: ${word}`);
    });

    socket.on('clearBoard', () => {
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    });

    socket.on('error', (errMsg) => {
      setError(errMsg);
    });

    return () => {
      socket.off('message');
      socket.off('guess');
      socket.off('scoreUpdate');
      socket.off('turn');
      socket.off('drawing');
      socket.off('word');
      socket.off('clearBoard');
      socket.off('error');
    };
  }, []);

  // Lobby event handlers
  const handleCreateRoom = (e) => {
    e.preventDefault();
    if (!roomId || !nickname) return;
    socket.emit('createRoom', { roomId, nickname });
    setJoined(true);
    setIsHost(true);
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (!roomId || !nickname) return;
    socket.emit('joinRoom', { roomId, nickname });
    setJoined(true);
  };

  // Start game (only host)
  const startGame = () => {
    socket.emit('startGame');
  };

  // Canvas drawing functions
  const startDrawing = (e) => {
    const { offsetX, offsetY } = e.nativeEvent;
    setCurrentPos({ x: offsetX, y: offsetY });
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = e.nativeEvent;
    const context = canvasRef.current.getContext('2d');
    context.beginPath();
    context.moveTo(currentPos.x, currentPos.y);
    context.lineTo(offsetX, offsetY);
    context.stroke();
    // Emit drawing data to server
    socket.emit('drawing', {
      prevX: currentPos.x,
      prevY: currentPos.y,
      x: offsetX,
      y: offsetY,
    });
    setCurrentPos({ x: offsetX, y: offsetY });
  };

  const endDrawing = () => {
    setIsDrawing(false);
  };

  // Handle sending a guess
  const sendGuess = (e) => {
    e.preventDefault();
    if (!guess.trim()) return;
    socket.emit('guess', guess);
    setGuess('');
  };

  // Render the lobby if not joined
  if (!joined) {
    return (
      <div className="lobby-container">
        <div className="lobby-form">
          <h1>Skribbl.io Clone</h1>
          <form>
            <input
              type="text"
              placeholder="Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
            <input
              type="text"
              placeholder="Nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
            <div className="lobby-buttons">
              <button onClick={handleCreateRoom}>Create Room</button>
              <button onClick={handleJoinRoom}>Join Room</button>
            </div>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
      </div>
    );
  }

  // Render the game interface once joined
  return (
    <div className="App">
      <h1>Skribbl.io Clone</h1>
      <div className="room-info">
        <p>
          <strong>Room:</strong> {roomId}
        </p>
        <p>
          <strong>Nickname:</strong> {nickname}
        </p>
      </div>
      {isHost && (
        <button onClick={startGame} className="start-button">
          Start Game
        </button>
      )}
      <div className="game-container">
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={endDrawing}
          onMouseLeave={endDrawing}
        />
        <div className="chat-container">
          <h2>Chat</h2>
          <ul className="chat-messages">
            {chatMessages.map((msg, index) => (
              <li key={index}>{msg}</li>
            ))}
          </ul>
          <form onSubmit={sendGuess}>
            <input
              type="text"
              placeholder={
                nickname === currentDrawer
                  ? "You're drawing – chat disabled"
                  : "Enter your guess"
              }
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              disabled={nickname === currentDrawer}
            />
            <button type="submit" disabled={nickname === currentDrawer}>
              Send
            </button>
          </form>
          <h2>Scores</h2>
          <ul className="scoreboard">
            {Object.entries(scores).map(([id, player]) => (
              <li key={id}>
                {player.nickname}: {player.score}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;
