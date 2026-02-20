/**
 * P2P RETRO ROGUELIKE - Versão PeerJS
 */

const TILE_SIZE = 32;
const MAP_SIZE = 40;

// --- NETWORK MANAGER (PEERJS) ---
class NetworkManager {
    constructor(game) {
        this.game = game;
        // Cria um ID aleatório de 4 dígitos para facilitar
        const shortId = Math.floor(1000 + Math.random() * 9000).toString();
        this.peer = new Peer(shortId); 
        this.conn = null;

        this.peer.on('open', (id) => {
            document.getElementById('my-id').innerText = id;
            document.getElementById('status').innerText = "Pronto para conectar!";
        });

        // Quando alguém conecta em você
        this.peer.on('connection', (conn) => {
            this.conn = conn;
            this.setupEvents();
        });

        this.peer.on('error', (err) => {
            alert("Erro no PeerJS: " + err.type);
        });
    }

    connectToPeer() {
        const targetId = document.getElementById('join-id').value;
        if (!targetId) return alert("Digite um ID!");
        this.conn = this.peer.connect(targetId);
        this.setupEvents();
    }

    setupEvents() {
        this.conn.on('open', () => {
            document.getElementById('status').innerText = "CONECTADO!";
            setTimeout(() => this.game.start(), 500);
        });

        this.conn.on('data', (data) => {
            this.game.handleRemoteData(data);
        });
    }

    send(data) {
        if (this.conn && this.conn.open) {
            this.conn.send(data);
        }
    }
}

// --- MAPA E ENTIDADES ---
class MapGenerator {
    generate() {
        let grid = Array(MAP_SIZE).fill().map(() => Array(MAP_SIZE).fill(1));
        let x = 20, y = 20;
        for(let i=0; i<600; i++) {
            grid[y][x] = 0;
            x += Math.floor(Math.random() * 3) - 1;
            y += Math.floor(Math.random() * 3) - 1;
            x = Math.max(1, Math.min(MAP_SIZE-2, x));
            y = Math.max(1, Math.min(MAP_SIZE-2, y));
        }
        return grid;
    }
}

class Player {
    constructor(x, y, type) {
        this.pos = {x, y};
        this.type = type;
        this.color = type === 'warrior' ? '#3498db' : '#9b59b6';
        this.hp = type === 'warrior' ? 120 : 70;
        this.maxHp = this.hp;
        this.atkCd = 0;
    }

    draw(ctx, offset) {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.pos.x - offset.x, this.pos.y - offset.y, 24, 24);
    }
}

// --- CORE DO JOGO ---
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.network = new NetworkManager(this);
        this.map = null;
        this.local = null;
        this.remote = null;
        this.keys = {};
        this.running = false;

        this.initInput();
    }

    setPlayerClass(type) {
        this.classType = type;
        document.querySelectorAll('.class-select button').forEach(b => b.classList.remove('active'));
        document.getElementById(`btn-${type}`).classList.add('active');
    }

    start() {
        document.getElementById('setup-menu').style.display = 'none';
        this.map = new MapGenerator().generate();
        this.local = new Player(20*32, 20*32, this.classType || 'warrior');
        this.remote = new Player(20*32, 20*32, 'warrior');
        this.running = true;
        this.resize();
        requestAnimationFrame(() => this.loop());
    }

    initInput() {
        window.addEventListener('keydown', e => this.keys[e.key.toLowerCase()] = true);
        window.addEventListener('keyup', e => this.keys[e.key.toLowerCase()] = false);
        // Mobile
        const bind = (id, k) => {
            const el = document.getElementById(id);
            el.ontouchstart = (e) => { e.preventDefault(); this.keys[k] = true; };
            el.ontouchend = (e) => { e.preventDefault(); this.keys[k] = false; };
        };
        bind('up', 'arrowup'); bind('down', 'arrowdown'); bind('left', 'arrowleft'); bind('right', 'arrowright');
        bind('btn-atk', 'z');
    }

    handleRemoteData(data) {
        if(!this.remote) return;
        this.remote.pos = data.pos;
        this.remote.hp = data.hp;
        if(data.isAtk) this.atkEffect(data.pos.x, data.pos.y);
    }

    atkEffect(x, y) {
        this.ctx.fillStyle = "white";
        this.ctx.beginPath();
        this.ctx.arc(x+12-this.offset.x, y+12-this.offset.y, 30, 0, Math.PI*2);
        this.ctx.fill();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    update() {
        let mx = 0, my = 0;
        if (this.keys['arrowup'] || this.keys['w']) my = -4;
        if (this.keys['arrowdown'] || this.keys['s']) my = 4;
        if (this.keys['arrowleft'] || this.keys['a']) mx = -4;
        if (this.keys['arrowright'] || this.keys['d']) mx = 4;

        if (mx !== 0 || my !== 0) {
            const nx = this.local.pos.x + mx;
            const ny = this.local.pos.y + my;
            if (this.map[Math.floor((ny+12)/32)][Math.floor((nx+12)/32)] === 0) {
                this.local.pos.x = nx;
                this.local.pos.y = ny;
            }
        }

        if(this.local.atkCd > 0) this.local.atkCd--;
        const isAtk = this.keys['z'] && this.local.atkCd === 0;
        if(isAtk) this.local.atkCd = 20;

        this.network.send({ pos: this.local.pos, hp: this.local.hp, isAtk: isAtk });
        
        // UI HP
        document.getElementById('hp-fill').style.width = (this.local.hp/this.local.maxHp)*100 + "%";
    }

    draw() {
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.offset = {
            x: this.local.pos.x - this.canvas.width / 2,
            y: this.local.pos.y - this.canvas.height / 2
        };

        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                if (this.map[y][x] === 1) {
                    this.ctx.fillStyle = '#333';
                    this.ctx.fillRect(x*32-this.offset.x, y*32-this.offset.y, 31, 31);
                }
            }
        }
        this.remote.draw(this.ctx, this.offset);
        this.local.draw(this.ctx, this.offset);
    }

    loop() {
        if(!this.running) return;
        this.update();
        this.draw();
        requestAnimationFrame(() => this.loop());
    }
}

window.game = new Game();
