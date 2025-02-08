// src/App.jsx
import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';
import VoiceChat from './VoiceChat';

const socket = io('http://localhost:5000');

function App() {
    // Lobby states
    const [joined, setJoined] = useState(false);
    const [roomId, setRoomId] = useState('');
    const [nickname, setNickname] = useState('');
    const [difficulty, setDifficulty] = useState('easy');
    const [isSpectator, setIsSpectator] = useState(false);
    const [isPublic, setIsPublic] = useState(false);
    const [error, setError] = useState('');
    const [voiceActive, setVoiceActive] = useState(false);
    // Game states
    const [chatMessages, setChatMessages] = useState([]);
    const [scores, setScores] = useState({});
    const [guess, setGuess] = useState('');
    const [currentDrawer, setCurrentDrawer] = useState('');
    const [timer, setTimer] = useState(60);
    const [winnerFlash, setWinnerFlash] = useState('');

    // Word selection modal state
    const [wordCandidates, setWordCandidates] = useState([]);
    const [showWordSelection, setShowWordSelection] = useState(false);

    // Global Leaderboard Modal state
    const [showGlobalLeaderboard, setShowGlobalLeaderboard] = useState(false);
    const [globalLeaderboard, setGlobalLeaderboard] = useState({});

    // Dark mode & Music state
    const [darkMode, setDarkMode] = useState(false);
    const [musicOn, setMusicOn] = useState(true);
    const musicRef = useRef(null);

    // Drawing states and tools
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });
    const [brushColor, setBrushColor] = useState('#000000');
    const [brushSize, setBrushSize] = useState(2);
    const [isEraser, setIsEraser] = useState(false);

    // Socket event listeners
    useEffect(() => {
        socket.on('message', (msgData) => {
            setChatMessages(prev => [...prev, `${msgData.user}: ${msgData.text}`]);
        });
        socket.on('guess', (msgData) => {
            setChatMessages(prev => [...prev, `${msgData.user}: ${msgData.guess}`]);
        });
        socket.on('scoreUpdate', (scoreData) => {
            setScores(scoreData);
        });
        socket.on('turn', (data) => {
            setCurrentDrawer(data.drawer);
            setChatMessages(prev => [...prev, `It's ${data.drawer}'s turn. Round ${data.round} of ${data.totalRounds}.`]);
        });
        socket.on('timer', (timeLeft) => {
            setTimer(timeLeft);
        });
        socket.on('warning', (msg) => {
            alert(msg);
        });
        socket.on('hint', (hintData) => {
            setChatMessages(prev => [...prev, `Hint: ${hintData.hint}`]);
        });
        socket.on('clearBoard', () => {
            if (canvasRef.current) {
                const context = canvasRef.current.getContext('2d');
                context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }
        });
        socket.on('wordCandidates', (candidates) => {
            setWordCandidates(candidates);
            setShowWordSelection(true);
        });
        socket.on('finalLeaderboard', (players) => {
            setChatMessages(prev => [...prev, 'Final Leaderboard:']);
            Object.values(players).forEach(player => {
                setChatMessages(prev => [...prev, `${player.nickname}: ${player.score}`]);
            });
        });
        socket.on('winnerAnnouncement', ({ winner }) => {
            setWinnerFlash(winner);
            // Clear the flash after a few seconds.
            setTimeout(() => setWinnerFlash(''), 5000);
        });
        socket.on('error', (errMsg) => {
            setError(errMsg);
        });

        return () => {
            socket.off('message');
            socket.off('guess');
            socket.off('scoreUpdate');
            socket.off('turn');
            socket.off('timer');
            socket.off('warning');
            socket.off('hint');
            socket.off('clearBoard');
            socket.off('wordCandidates');
            socket.off('finalLeaderboard');
            socket.off('winnerAnnouncement');
            socket.off('error');
        }
    }, []);

    // Background music control
    useEffect(() => {
        if (musicRef.current) {
            if (musicOn) {
                musicRef.current.play();
            } else {
                musicRef.current.pause();
            }
        }
    }, [musicOn]);

    // Lobby event handlers
    const handleCreateRoom = (e) => {
        e.preventDefault();
        if (!roomId || !nickname) return;
        socket.emit('createRoom', { roomId, nickname, difficulty, totalRounds: 5, isSpectator, language: 'en', isPublic });
        setJoined(true);
    };

    const handleJoinRoom = (e) => {
        e.preventDefault();
        if (!roomId || !nickname) return;
        socket.emit('joinRoom', { roomId, nickname, isSpectator });
        setJoined(true);
    };

    // Word selection by drawer
    const handleWordSelect = (word) => {
        socket.emit('selectWord', word);
        setShowWordSelection(false);
    };

    // Drawing functions (only active for the current drawer)
    const startDrawing = (e) => {
        if (nickname === currentDrawer) {
            const { offsetX, offsetY } = e.nativeEvent;
            setCurrentPos({ x: offsetX, y: offsetY });
            setIsDrawing(true);
        }
    };

    const draw = (e) => {
        if (!isDrawing) return;
        const { offsetX, offsetY } = e.nativeEvent;
        const context = canvasRef.current.getContext('2d');
        context.strokeStyle = isEraser ? '#fff' : brushColor;
        context.lineWidth = brushSize;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(currentPos.x, currentPos.y);
        context.lineTo(offsetX, offsetY);
        context.stroke();
        socket.emit('drawing', { prevX: currentPos.x, prevY: currentPos.y, x: offsetX, y: offsetY, color: isEraser ? '#fff' : brushColor, brushSize });
        setCurrentPos({ x: offsetX, y: offsetY });
    };

    const endDrawing = () => {
        setIsDrawing(false);
    };

    const clearCanvas = () => {
        const context = canvasRef.current.getContext('2d');
        context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    };

    // Handle sending a guess.
    const sendGuess = (e) => {
        e.preventDefault();
        if (!guess.trim()) return;
        socket.emit('guess', guess);
        setGuess('');
    };

    // Vote to skip round.
    const voteSkip = () => {
        socket.emit('voteSkip');
    };

    // Toggle dark mode and music.
    const toggleDarkMode = () => setDarkMode(prev => !prev);
    const toggleMusic = () => setMusicOn(prev => !prev);

    // Fetch global leaderboard from the server.
    const fetchGlobalLeaderboard = async () => {
        try {
            const res = await fetch('http://localhost:5000/leaderboard');
            const data = await res.json();
            setGlobalLeaderboard(data);
            setShowGlobalLeaderboard(true);
        } catch (error) {
            console.error('Error fetching leaderboard:', error);
        }
    };

    // Append an emoji to the guess input.
    const addEmoji = (emoji) => {
        setGuess(prev => prev + emoji);
    };

    if (!joined) {
        return (
            <div className="lobby-container">
                <div className="lobby-form">
                    <h1>Skribbl.io Clone</h1>
                    <form>
                        <input type="text" placeholder="Room ID" value={roomId} onChange={e => setRoomId(e.target.value)} />
                        <input type="text" placeholder="Nickname" value={nickname} onChange={e => setNickname(e.target.value)} />
                        <select value={difficulty} onChange={e => setDifficulty(e.target.value)}>
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                        </select>
                        <label>
                            <input type="checkbox" checked={isSpectator} onChange={e => setIsSpectator(e.target.checked)} />
                            Join as Spectator
                        </label>
                        <label>
                            <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
                            Public Room
                        </label>
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

    return (
        <div className={`App ${darkMode ? 'dark' : ''}`}>
            <h1>Skribbl.io Clone</h1>
            <div className="controls">
                <button onClick={toggleDarkMode}>{darkMode ? 'Light Mode' : 'Dark Mode'}</button>
                <button onClick={toggleMusic}>{musicOn ? 'Music Off' : 'Music On'}</button>
                <button onClick={fetchGlobalLeaderboard}>View Global Leaderboard</button>
                <button onClick={() => setVoiceActive(prev => !prev)}>
                    {voiceActive ? 'Stop Voice Chat' : 'Start Voice Chat'}
                </button>
            </div>
            {winnerFlash && <div className="winner-flash">WINNER: {winnerFlash}!</div>}
            <div className="room-info">
                <p><strong>Room:</strong> {roomId}</p>
                <p><strong>Nickname:</strong> {nickname}</p>
            </div>
            <div className="game-info">
                <div className="timer">Time left: {timer}s</div>
                <button onClick={voteSkip} disabled={nickname === currentDrawer}>Vote to Skip Round</button>
            </div>
            {voiceActive && <VoiceChat socket={socket} roomId={roomId} />}
            <div className="game-container">
                <div className="canvas-container">
                    {nickname === currentDrawer && (
                        <div className="toolbar">
                            <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} />
                            <input type="range" min="1" max="10" value={brushSize} onChange={e => setBrushSize(e.target.value)} />
                            <button onClick={() => setIsEraser(!isEraser)}>{isEraser ? 'Disable Eraser' : 'Eraser'}</button>
                            <button onClick={clearCanvas}>Clear Canvas</button>
                        </div>
                    )}
                    <canvas ref={canvasRef} width={800} height={600}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={endDrawing}
                        onMouseLeave={endDrawing} />
                </div>
                <div className="chat-container">
                    <h2>Chat</h2>
                    <div className="voice-chat">
                        <button>Start Voice Chat</button>
                    </div>
                    <ul className="chat-messages">
                        {chatMessages.map((msg, idx) => <li key={idx}>{msg}</li>)}
                    </ul>
                    <form onSubmit={sendGuess}>
                        <input type="text" placeholder={nickname === currentDrawer ? "You're drawing – chat disabled" : "Enter your guess"}
                            value={guess} onChange={e => setGuess(e.target.value)} disabled={nickname === currentDrawer} />
                        <button type="submit" disabled={nickname === currentDrawer}>Send</button>
                        <button type="button" onClick={() => addEmoji('😊')}>😊</button>
                    </form>
                    <h2>Scores</h2>
                    <ul className="scoreboard">
                        {Object.entries(scores).map(([id, player]) => (
                            <li key={id}>{player.nickname}: {player.score}</li>
                        ))}
                    </ul>
                </div>
            </div>

            {showWordSelection && (
                <div className="modal">
                    <div className="modal-content">
                        <h2>Select a Word</h2>
                        {wordCandidates.map((word, idx) => (
                            <button key={idx} onClick={() => handleWordSelect(word)}>{word}</button>
                        ))}
                    </div>
                </div>
            )}

            {showGlobalLeaderboard && (
                <div className="modal">
                    <div className="modal-content">
                        <h2>Global Leaderboard</h2>
                        <ul>
                            {Object.entries(globalLeaderboard).map(([name, score]) => (
                                <li key={name}>{name}: {score}</li>
                            ))}
                        </ul>
                        <button onClick={() => setShowGlobalLeaderboard(false)}>Close</button>
                    </div>
                </div>
            )}

            <audio ref={musicRef} loop src="background-music.mp3" />
        </div>
    );
}

export default App;
