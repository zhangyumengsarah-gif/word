const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 1. 配置 Socket.io 允许所有源连接（解决异地联机可能的跨域问题）
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

let players = [];
let deck = [];
let gameState = {
    currentPlayer: 0,
    lastDiscard: null,
    status: 'waiting' // waiting, playing, peng_check
};

// 初始化牌堆：A-Z 每种3张
function initDeck() {
    let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    let newDeck = [];
    for (let i = 0; i < 3; i++) {
        newDeck = newDeck.concat(letters);
    }
    return newDeck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    console.log(`新连接请求: ${socket.id}`);

    // 限制仅限两名玩家
    if (players.length < 2) {
        players.push(socket);
        const playerIdx = players.length - 1;
        socket.emit('playerID', playerIdx);
        console.log(`玩家 ${playerIdx} 已就位`);
    } else {
        socket.emit('status', '游戏已满员');
        return;
    }

    // 检查并开始游戏
    if (players.length === 2 && gameState.status === 'waiting') {
        deck = initDeck();
        gameState.status = 'playing';
        
        const hand0 = deck.splice(0, 13);
        const hand1 = deck.splice(0, 13);
        
        players[0].emit('gameStart', { hand: hand0, isMyTurn: true });
        players[1].emit('gameStart', { hand: hand1, isMyTurn: false });
        console.log("游戏正式开始，发牌完毕");
    }

    // 摸牌
    socket.on('drawTile', () => {
        if (deck.length > 0) {
            const tile = deck.pop();
            socket.emit('receiveTile', tile);
        } else {
            io.emit('gameOver', '牌堆已空，平局！');
        }
    });

    // 出牌
    socket.on('discardTile', (tile) => {
        gameState.lastDiscard = tile;
        const playerIdx = players.indexOf(socket);
        const otherPlayerIdx = playerIdx === 0 ? 1 : 0;
        
        gameState.status = 'peng_check';
        // 向另一方发送碰牌请求
        if (players[otherPlayerIdx]) {
            players[otherPlayerIdx].emit('askPeng', tile);
        }
        io.emit('updateDiscard', tile);
    });

    // 碰牌逻辑处理
    socket.on('pengResponse', (doPeng) => {
        const playerIdx = players.indexOf(socket);
        const otherPlayerIdx = playerIdx === 0 ? 1 : 0;

        if (doPeng) {
            socket.emit('confirmPeng', gameState.lastDiscard);
            gameState.currentPlayer = playerIdx;
            gameState.status = 'playing';
        } else {
            // 如果不碰，轮到该玩家摸牌
            socket.emit('yourTurnToDraw');
            gameState.status = 'playing';
        }
    });

    // 胜利宣告同步
    socket.on('winDeclaration', (hand) => {
        const winnerIdx = players.indexOf(socket);
        io.emit('announceWinner', { winner: winnerIdx, hand: hand });
    });

    // 掉线处理
    socket.on('disconnect', () => {
        console.log(`玩家断开连接: ${socket.id}`);
        players = players.filter(p => p.id !== socket.id);
        gameState.status = 'waiting';
        // 通知剩下的人游戏结束或重置
        io.emit('playerDisconnected');
    });
});

// 2. 关键修改：使用环境变量端口，适配 Render/Heroku 等云平台
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`-----------------------------------`);
    console.log(`游戏服务器已启动！`);
    console.log(`本地访问: http://localhost:${PORT}`);
    console.log(`-----------------------------------`);
});