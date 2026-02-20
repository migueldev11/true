/**
 * P2P RETRO ROGUELIKE
 * Game Logic & Networking
 */

const TILE_SIZE = 32;
const MAP_SIZE = 40; // 40x40 tiles

class Vector {
    constructor(x, y) { this.x = x; this.y = y; }
}

// --- NETWORK MANAGER ---
class NetworkManager {
    constructor(game) {
        this.game = game;
        this.peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.dataChannel = null;
        this.isHost = false;

        this.peer.onicecandidate = (e) => {
            if (!e.candidate) document.getElementById('output-sdp').value = JSON.stringify(this.peer.localDescription);
        };

        this.peer.ondatachannel = (e) => {
            this.dataChannel = e.channel;
            this.setupDataChannel();
        };
    }

    async hostGame() {
        this.isHost = true;
        this.dataChannel = this.peer.createDataChannel("gameChannel");
        this.setupDataChannel();
        const offer = await this.peer.createOffer();
        await this.peer.setLocalDescription(offer);
    }

    async connectP2P() {
        const input = document.getElementById('input-sdp').value;
        if (!input) return;
        const remoteDesc = new RTCSessionDescription(JSON.parse(input));
        
        await this.peer.setRemoteDescription(remoteDesc);
        if (remoteDesc.type === "offer") {
            const answer = await this.peer.createAnswer();
            await this.peer.setLocalDescription(answer);
            document.getElementById('output-sdp').value = JSON.stringify(this.peer.localDescription);
        }
    }

    setupDataChannel() {
        this.dataChannel.onopen = () => {
            document.getElementById('status').innerText = "Conectado!";
            setTimeout(() => this.game.start(), 1000);
        };
        this.dataChannel.onmessage = (e) => this.game.handleRemoteData(JSON.parse(e.data));
    }

    send(data) {
        if (this.dataChannel && this.dataChannel.readyState === "open") {
            this.dataChannel.send(JSON.stringify(data));
        }
    }

    copySDP(id) {
        const copyText = document.getElementById(id);
        copyText.select();
        navigator.clipboard.writeText(copyText.value);
    }
}

// --- MAP GENERATOR ---
class MapGenerator {
    constructor(seed) {
        this.seed = seed;
        this.grid = Array(MAP_SIZE).fill().map(() => Array(MAP_SIZE).fill(1));
    }

    generate() {
        // Simple random walk for the dungeon
        let x = Math.floor(MAP_SIZE/2), y = Math.floor(MAP_SIZE/2);
        for(let i=0; i<400; i++) {
            this.grid[y][x] = 0;
            if (Math.random() < 0.05) this.grid[y][x] = 2; // Lava
            x += Math.floor(Math.random() * 3) - 1;
            y += Math.floor(Math.random() * 3) - 1;
            x = Math.max(1, Math.min(MAP_SIZE-2, x));
            y = Math.max(1, Math.min(MAP_SIZE-2, y));
        }
        return this.grid;
    }
}

// --- ENTITIES ---
class Entity {
    constructor(x, y, color) {
        this.pos = new Vector(x, y);
        this.vel = new Vector(0, 0);
        this.hp = 100;
        this.maxHp = 100;
        this.color = color;
        this.size = 24;
        this.dir = { x: 0, y: 1 };
    }

    draw(ctx, offset) {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.pos.x - offset.x, this.pos.y - offset.y, this.size, this.size);
    }
}

class Player extends Entity {
    constructor(x, y, type) {
        super(x, y, type === 'warrior' ? '#3498db' : '#9b59b6');
        this.type = type;
        this.speed = 4;
        this.maxHp = type === 'warrior' ? 120 : 70;
        this.hp = this.maxHp;
        this.atkCooldown = 0;
        this.skillCooldown = 0;
    }

    update() {
        if (this.atkCooldown > 0) this.atkCooldown--;
        if (this.skillCooldown > 0) this.skillCooldown--;
    }
}

// --- MAIN GAME ---
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.network = new NetworkManager(this);
        this.map = null;
        this.localPlayer = null;
        this.remotePlayer = null;
        this.keys = {};
        this.enemies = [];
        this.running = false;
        this.lastTime = 0;
        this.classType = 'warrior';

        this.initControls();
        this.resize();
        window.onresize = () => this.resize();
    }

    resize() {
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
    }

    setPlayerClass(type) {
        this.classType = type;
        document.querySelectorAll('.class-select button').forEach(b => b.classList.remove('active'));
        document.getElementById(`btn-${type}`).classList.add('active');
    }

    start() {
        document.getElementById('setup-menu').style.display = 'none';
        const gen = new MapGenerator(this.network.isHost ? 123 : 123); // Same seed for now
        this.map = gen.generate();
        
        const spawnX = Math.floor(MAP_SIZE/2) * TILE_SIZE;
        const spawnY = Math.floor(MAP_SIZE/2) * TILE_SIZE;
        
        this.localPlayer = new Player(spawnX, spawnY, this.classType);
        this.remotePlayer = new Player(spawnX, spawnY, 'warrior'); 
        
        this.running = true;
        requestAnimationFrame((t) => this.loop(t));
    }

    initControls() {
        window.addEventListener('keydown', e => this.keys[e.key] = true);
        window.addEventListener('keyup', e => this.keys[e.key] = false);
        // Mobile listeners
        const bind = (id, k) => {
            const el = document.getElementById(id);
            el.ontouchstart = () => this.keys[k] = true;
            el.ontouchend = () => this.keys[k] = false;
        };
        bind('up', 'ArrowUp'); bind('down', 'ArrowDown'); bind('left', 'ArrowLeft'); bind('right', 'ArrowRight');
        bind('btn-atk', 'z'); bind('btn-skill', 'x');
    }

    handleRemoteData(data) {
        if (!this.remotePlayer) return;
        this.remotePlayer.pos.x = data.x;
        this.remotePlayer.pos.y = data.y;
        this.remotePlayer.type = data.type;
        this.remotePlayer.hp = data.hp;
        if (data.isAttacking) this.spawnEffect(data.x, data.y, '#fff');
    }

    update(dt) {
        if (!this.running) return;

        let mx = 0, my = 0;
        if (this.keys['ArrowUp'] || this.keys['w']) my = -1;
        if (this.keys['ArrowDown'] || this.keys['s']) my = 1;
        if (this.keys['ArrowLeft'] || this.keys['a']) mx = -1;
        if (this.keys['ArrowRight'] || this.keys['d']) mx = 1;

        if (mx !== 0 || my !== 0) {
            const nextX = this.localPlayer.pos.x + mx * this.localPlayer.speed;
            const nextY = this.localPlayer.pos.y + my * this.localPlayer.speed;
            
            // Basic collision
            const tx = Math.floor((nextX + 12) / TILE_SIZE);
            const ty = Math.floor((nextY + 12) / TILE_SIZE);
            if (this.map[ty][tx] === 0) {
                this.localPlayer.pos.x = nextX;
                this.localPlayer.pos.y = nextY;
            }
            this.localPlayer.dir = { x: mx, y: my };
        }

        this.localPlayer.update();

        // Sync to Peer
        this.network.send({
            x: this.localPlayer.pos.x,
            y: this.localPlayer.pos.y,
            type: this.localPlayer.type,
            hp: this.localPlayer.hp,
            isAttacking: this.keys['z'] && this.localPlayer.atkCooldown === 0
        });

        if (this.keys['z'] && this.localPlayer.atkCooldown === 0) {
            this.localPlayer.atkCooldown = 20;
            this.spawnEffect(this.localPlayer.pos.x, this.localPlayer.pos.y, "yellow");
        }

        this.updateUI();
    }

    spawnEffect(x, y, color) {
        // Visual feedback
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(x, y, 40, 0, Math.PI * 2);
        this.ctx.fill();
    }

    updateUI() {
        document.getElementById('hp-fill').style.width = `${(this.localPlayer.hp / this.localPlayer.maxHp) * 100}%`;
        document.getElementById('cd-fill').style.width = `${(1 - this.localPlayer.atkCooldown / 20) * 100}%`;
        document.getElementById('player-class-label').innerText = this.localPlayer.type.toUpperCase();
    }

    draw() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const offset = {
            x: this.localPlayer.pos.x - this.canvas.width / 2,
            y: this.localPlayer.pos.y - this.canvas.height / 2
        };

        // Draw Map
        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const tile = this.map[y][x];
                if (tile === 1) this.ctx.fillStyle = '#444';
                else if (tile === 2) this.ctx.fillStyle = '#e67e22'; // Lava
                else this.ctx.fillStyle = '#222';
                
                this.ctx.fillRect(x * TILE_SIZE - offset.x, y * TILE_SIZE - offset.y, TILE_SIZE - 1, TILE_SIZE - 1);
            }
        }

        this.remotePlayer.draw(this.ctx, offset);
        this.localPlayer.draw(this.ctx, offset);
    }

    loop(time) {
        const dt = (time - this.lastTime) / 1000;
        this.lastTime = time;
        this.update(dt);
        this.draw();
        requestAnimationFrame((t) => this.loop(t));
    }
}

// Inicializar globalmente para acesso nos botões do HTML
window.game = new Game();

