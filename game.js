/**
 * P2P ASCII ROGUELIKE - Versão Final Otimizada
 * Arquitetura Modular | WebRTC (PeerJS) | Layout Mobile Adaptativo
 */

const CONFIG = {
    TILE_SIZE: 32,
    MAP_W: 50,
    MAP_H: 50,
    FONT: '28px "Courier New", monospace'
};

// --- NETWORKING (Gerenciamento de Conexão P2P) ---
class NetworkManager {
    constructor(game) {
        this.game = game;
        // Gera um ID aleatório de 4 dígitos
        const shortId = Math.floor(1000 + Math.random() * 9000).toString();
        this.peer = new Peer(shortId); 
        this.conn = null;
        this.isHost = false;

        this.peer.on('open', (id) => {
            document.getElementById('my-id').innerText = id;
            document.getElementById('status').innerText = "Pronto! Passe o ID ou conecte-se.";
        });

        this.peer.on('connection', (conn) => {
            this.conn = conn;
            this.isHost = true;
            this.setupEvents();
        });
    }

    connectToPeer() {
        const targetId = document.getElementById('join-id').value;
        if (!targetId) return;
        this.conn = this.peer.connect(targetId);
        this.isHost = false;
        this.setupEvents();
    }

    setupEvents() {
        this.conn.on('open', () => {
            document.getElementById('status').innerText = "CONECTADO!";
            document.getElementById('net-status').innerText = "ONLINE";
            document.getElementById('net-status').style.color = "lime";
            // Pequeno delay para garantir estabilidade antes de iniciar
            setTimeout(() => this.game.start(this.isHost), 500);
        });

        this.conn.on('data', (data) => this.game.handleNetworkData(data));
    }

    send(data) {
        if (this.conn && this.conn.open) this.conn.send(data);
    }
}

// --- MAP GENERATOR (Salas e Corredores) ---
class MapGenerator {
    generate() {
        let grid = Array(CONFIG.MAP_H).fill(0).map(() => Array(CONFIG.MAP_W).fill('#'));
        let rooms = [];
        
        for (let i = 0; i < 15; i++) {
            let w = Math.floor(Math.random() * 6) + 4;
            let h = Math.floor(Math.random() * 6) + 4;
            let x = Math.floor(Math.random() * (CONFIG.MAP_W - w - 2)) + 1;
            let y = Math.floor(Math.random() * (CONFIG.MAP_H - h - 2)) + 1;
            
            let room = { x, y, w, h, cx: Math.floor(x + w/2), cy: Math.floor(y + h/2) };
            
            // Escava Sala
            for (let ry = y; ry < y + h; ry++) {
                for (let rx = x; rx < x + w; rx++) {
                    grid[ry][rx] = '.';
                    if(Math.random() < 0.02) grid[ry][rx] = '~'; // Adiciona Lava aleatória
                }
            }

            if (rooms.length > 0) {
                let prev = rooms[rooms.length - 1];
                this.carveCorridor(grid, prev.cx, prev.cy, room.cx, room.cy);
            }
            rooms.push(room);
        }
        return { grid, rooms };
    }

    carveCorridor(grid, x1, y1, x2, y2) {
        let x = x1, y = y1;
        while (x !== x2 || y !== y2) {
            if (x !== x2) x += (x2 > x) ? 1 : -1;
            else if (y !== y2) y += (y2 > y) ? 1 : -1;
            grid[y][x] = '.';
        }
    }
}

// --- ENTITIES (Jogadores e Inimigos) ---
class Entity {
    constructor(x, y, char, color, hp) {
        this.x = x;
        this.y = y;
        this.char = char;
        this.color = color;
        this.hp = hp;
        this.maxHp = hp;
    }
    draw(ctx, offX, offY) {
        ctx.fillStyle = this.color;
        ctx.fillText(this.char, (this.x * CONFIG.TILE_SIZE) - offX, (this.y * CONFIG.TILE_SIZE) - offY + CONFIG.TILE_SIZE);
    }
}

class Player extends Entity {
    constructor(x, y, type) {
        super(x, y, '@', type === 'warrior' ? '#3498db' : '#9b59b6', type === 'warrior' ? 120 : 80);
        this.type = type;
        this.moveDelay = 0;
        this.atkDelay = 0;
        this.dir = {x: 0, y: 1};
    }
}

class Enemy extends Entity {
    constructor(x, y, isBoss) {
        super(x, y, isBoss ? 'B' : 'E', isBoss ? '#c0392b' : '#e74c3c', isBoss ? 200 : 40);
        this.isBoss = isBoss;
        this.moveTimer = 0;
    }
    update(map, target1, target2) {
        this.moveTimer++;
        if (this.moveTimer < (this.isBoss ? 45 : 65)) return; 
        this.moveTimer = 0;

        let d1 = Math.abs(this.x - target1.x) + Math.abs(this.y - target1.y);
        let d2 = (target2 && target2.hp > 0) ? Math.abs(this.x - target2.x) + Math.abs(this.y - target2.y) : Infinity;
        let target = d1 < d2 ? target1 : target2;
        
        if (!target || target.hp <= 0) return;

        let dx = Math.sign(target.x - this.x);
        let dy = Math.sign(target.y - this.y);

        if (Math.abs(target.x - this.x) + Math.abs(target.y - this.y) === 1) {
            target.hp -= this.isBoss ? 15 : 8; 
        } else {
            let nx = this.x + (Math.random() > 0.5 ? dx : 0);
            let ny = this.y + (nx === this.x ? dy : 0);
            if (map[ny][nx] !== '#') {
                this.x = nx;
                this.y = ny;
            }
        }
    }
}

// --- CORE GAME ENGINE ---
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.network = new NetworkManager(this);
        this.keys = {};
        this.running = false;
        this.classType = 'warrior';
        
        this.mapData = null;
        this.localPlayer = null;
        this.remotePlayer = null;
        this.enemies = [];
        this.items = [];
        
        this.initInput();
        window.addEventListener('resize', () => this.resize());
        this.resize();
    }

    setPlayerClass(type) {
        this.classType = type;
        document.querySelectorAll('.class-select button').forEach(b => b.classList.remove('active'));
        document.getElementById(`btn-${type}`).classList.add('active');
    }

    // NOVA FUNÇÃO RESIZE: Lê o tamanho direto do CSS para suportar o layout mobile
    resize() {
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
        this.ctx.font = CONFIG.FONT;
        this.ctx.textBaseline = "bottom";
    }

    start(isHost) {
        document.getElementById('setup-menu').style.display = 'none';
        
        if (isHost) {
            this.mapData = new MapGenerator().generate();
            this.spawnEntities();
            this.network.send({ type: 'INIT', map: this.mapData.grid, enemies: this.enemies, items: this.items });
        }
        
        let spawn = isHost ? this.mapData.rooms[0] : {cx: 0, cy: 0}; 
        this.localPlayer = new Player(spawn.cx, spawn.cy, this.classType);
        this.remotePlayer = new Player(spawn.cx, spawn.cy, 'warrior');
        
        document.getElementById('player-class-label').innerText = this.classType.toUpperCase();
        this.running = true;
        requestAnimationFrame(() => this.loop());
    }

    spawnEntities() {
        this.enemies = [];
        this.items = [];
        for (let i = 1; i < this.mapData.rooms.length; i++) {
            let room = this.mapData.rooms[i];
            if (i === this.mapData.rooms.length - 1) {
                this.enemies.push(new Enemy(room.cx, room.cy, true));
            } else {
                this.enemies.push(new Enemy(room.cx, room.cy, false));
                if(Math.random() > 0.6) this.items.push({x: room.cx+1, y: room.cy, char: '+', color: '#2ecc71', type: 'heal'});
            }
        }
    }

    handleNetworkData(data) {
        if (data.type === 'INIT') {
            this.mapData = { grid: data.map };
            this.enemies = data.enemies.map(e => Object.assign(new Enemy(), e));
            this.items = data.items;
            // Posiciona o cliente em um local seguro
            this.localPlayer.x = data.enemies[0].x; 
            this.localPlayer.y = data.enemies[0].y;
        } else if (data.type === 'SYNC') {
            this.remotePlayer.x = data.x;
            this.remotePlayer.y = data.y;
            this.remotePlayer.hp = data.hp;
            this.remotePlayer.type = data.cType;
            if(data.enemies) this.enemies = data.enemies;
            if(data.atk) this.drawAtkEffect = { ...data.atk, timer: 10 };
        }
    }

    initInput() {
        const setKey = (k, v) => this.keys[k.toLowerCase()] = v;
        window.addEventListener('keydown', e => setKey(e.key, true));
        window.addEventListener('keyup', e => setKey(e.key, false));
        
        const bindBtn = (id, key) => {
            const btn = document.getElementById(id);
            if(!btn) return;
            btn.addEventListener('pointerdown', (e) => { e.preventDefault(); setKey(key, true); });
            btn.addEventListener('pointerup', (e) => { e.preventDefault(); setKey(key, false); });
            btn.addEventListener('pointerleave', (e) => { e.preventDefault(); setKey(key, false); });
        };
        
        bindBtn('up', 'arrowup'); bindBtn('down', 'arrowdown'); 
        bindBtn('left', 'arrowleft'); bindBtn('right', 'arrowright');
        bindBtn('btn-atk', 'z'); bindBtn('btn-skill', 'x');
    }

    update() {
        if (!this.localPlayer || this.localPlayer.hp <= 0) return;

        // Movimento
        if (this.localPlayer.moveDelay > 0) this.localPlayer.moveDelay--;
        else {
            let dx = 0, dy = 0;
            if (this.keys['arrowup'] || this.keys['w']) dy = -1;
            else if (this.keys['arrowdown'] || this.keys['s']) dy = 1;
            else if (this.keys['arrowleft'] || this.keys['a']) dx = -1;
            else if (this.keys['arrowright'] || this.keys['d']) dx = 1;

            if (dx !== 0 || dy !== 0) {
                let nx = this.localPlayer.x + dx;
                let ny = this.localPlayer.y + dy;
                this.localPlayer.dir = {x: dx, y: dy};
                
                if (this.mapData.grid[ny] && this.mapData.grid[ny][nx] !== '#') {
                    this.localPlayer.x = nx;
                    this.localPlayer.y = ny;
                    if(this.mapData.grid[ny][nx] === '~') this.localPlayer.hp -= 2;
                    
                    this.items = this.items.filter(i => {
                        if(i.x === nx && i.y === ny) {
                            if(i.type === 'heal') this.localPlayer.hp = Math.min(this.localPlayer.maxHp, this.localPlayer.hp + 25);
                            return false;
                        }
                        return true;
                    });
                }
                this.localPlayer.moveDelay = 10;
            }
        }

        // Ataque
        let atkPos = null;
        if (this.localPlayer.atkDelay > 0) this.localPlayer.atkDelay--;
        else if (this.keys['z']) {
            let tx = this.localPlayer.x + this.localPlayer.dir.x;
            let ty = this.localPlayer.y + this.localPlayer.dir.y;
            atkPos = {x: tx, y: ty};
            this.enemies.forEach(e => {
                if(e.x === tx && e.y === ty) e.hp -= (this.localPlayer.type === 'warrior' ? 20 : 12);
            });
            this.localPlayer.atkDelay = 25;
            this.drawAtkEffect = { x: tx, y: ty, timer: 10 };
        }

        // Lógica do Host
        if (this.network.isHost) {
            this.enemies = this.enemies.filter(e => e.hp > 0);
            this.enemies.forEach(e => e.update(this.mapData.grid, this.localPlayer, this.remotePlayer));
        }

        // Sincronização
        let sync = { 
            type: 'SYNC', x: this.localPlayer.x, y: this.localPlayer.y, 
            hp: this.localPlayer.hp, cType: this.classType, atk: atkPos 
        };
        if(this.network.isHost) sync.enemies = this.enemies;
        this.network.send(sync);

        document.getElementById('hp-fill').style.width = Math.max(0, (this.localPlayer.hp / this.localPlayer.maxHp) * 100) + "%";
    }

    draw() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (!this.mapData) return;

        let offX = (this.localPlayer.x * CONFIG.TILE_SIZE) - (this.canvas.width / 2);
        let offY = (this.localPlayer.y * CONFIG.TILE_SIZE) - (this.canvas.height / 2);

        // Render Map
        for (let y = 0; y < CONFIG.MAP_H; y++) {
            for (let x = 0; x < CONFIG.MAP_W; x++) {
                let char = this.mapData.grid[y][x];
                let screenX = (x * CONFIG.TILE_SIZE) - offX;
                let screenY = (y * CONFIG.TILE_SIZE) - offY;
                
                if (screenX < -32 || screenX > this.canvas.width || screenY < -32 || screenY > this.canvas.height) continue;

                if (char === '#') this.ctx.fillStyle = '#444';
                else if (char === '.') this.ctx.fillStyle = '#222';
                else if (char === '~') this.ctx.fillStyle = '#d35400';
                this.ctx.fillText(char, screenX, screenY + CONFIG.TILE_SIZE);
            }
        }

        this.items.forEach(i => {
            this.ctx.fillStyle = i.color;
            this.ctx.fillText(i.char, (i.x * CONFIG.TILE_SIZE) - offX, (i.y * CONFIG.TILE_SIZE) - offY + CONFIG.TILE_SIZE);
        });

        if (this.drawAtkEffect && this.drawAtkEffect.timer > 0) {
            this.ctx.fillStyle = "rgba(255,255,255,0.4)";
            this.ctx.fillRect((this.drawAtkEffect.x * CONFIG.TILE_SIZE) - offX, (this.drawAtkEffect.y * CONFIG.TILE_SIZE) - offY, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            this.drawAtkEffect.timer--;
        }

        this.enemies.forEach(e => e.draw(this.ctx, offX, offY));
        if(this.remotePlayer.hp > 0) this.remotePlayer.draw(this.ctx, offX, offY);
        if(this.localPlayer.hp > 0) this.localPlayer.draw(this.ctx, offX, offY);
        else {
            this.ctx.fillStyle = 'red';
            this.ctx.fillText("FIM DE JOGO", this.canvas.width/2 - 60, this.canvas.height/2);
        }
    }

    loop() {
        if (!this.running) return;
        this.update();
        this.draw();
        requestAnimationFrame(() => this.loop());
    }
}

window.game = new Game();
        
