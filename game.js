/**
 * P2P ASCII ROGUELIKE
 * Arquitetura Modular | WebRTC (PeerJS) | Gerador de Salas
 */

const CONFIG = {
    TILE_SIZE: 32,
    MAP_W: 50,
    MAP_H: 50,
    FONT: '28px "Courier New", monospace'
};

// --- NETWORKING ---
class NetworkManager {
    constructor(game) {
        this.game = game;
        const shortId = Math.floor(1000 + Math.random() * 9000).toString();
        this.peer = new Peer(shortId); 
        this.conn = null;
        this.isHost = false;

        this.peer.on('open', (id) => {
            document.getElementById('my-id').innerText = id;
            document.getElementById('status').innerText = "Pronto! Aguardando ou conecte-se a alguém.";
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
            setTimeout(() => this.game.start(this.isHost), 500);
        });

        this.conn.on('data', (data) => this.game.handleNetworkData(data));
    }

    send(data) {
        if (this.conn && this.conn.open) this.conn.send(data);
    }
}

// --- MAP GENERATOR ---
class MapGenerator {
    generate() {
        let grid = Array(CONFIG.MAP_H).fill(0).map(() => Array(CONFIG.MAP_W).fill('#'));
        let rooms = [];
        
        // BSP/Room Placement Simples
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
                    if(Math.random() < 0.02) grid[ry][rx] = '~'; // Lava
                }
            }

            // Conecta com a sala anterior (Corredores)
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

// --- ENTITIES ---
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
        if (this.moveTimer < (this.isBoss ? 40 : 60)) return; // Velocidade do inimigo
        this.moveTimer = 0;

        // Acha o alvo mais próximo
        let d1 = Math.abs(this.x - target1.x) + Math.abs(this.y - target1.y);
        let d2 = target2 ? Math.abs(this.x - target2.x) + Math.abs(this.y - target2.y) : Infinity;
        let target = d1 < d2 ? target1 : target2;
        if (!target) return;

        let dx = Math.sign(target.x - this.x);
        let dy = Math.sign(target.y - this.y);

        // Move ou Ataca
        if (Math.abs(target.x - this.x) + Math.abs(target.y - this.y) === 1) {
            target.hp -= this.isBoss ? 15 : 5; // Ataca jogador
        } else {
            let nx = this.x + (Math.random() > 0.5 ? dx : 0);
            let ny = this.y + (nx === this.x ? dy : 0);
            if (map[ny][nx] === '.') {
                this.x = nx;
                this.y = ny;
            }
        }
    }
}

// --- CORE GAME ---
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

    start(isHost) {
        document.getElementById('setup-menu').style.display = 'none';
        
        // Host gera o mapa e envia
        if (isHost) {
            this.mapData = new MapGenerator().generate();
            this.spawnEntities();
            this.network.send({ type: 'INIT', map: this.mapData.grid, enemies: this.enemies });
        }
        
        let spawn = isHost ? this.mapData.rooms[0] : {cx: 2, cy: 2}; // Fallback temporário
        this.localPlayer = new Player(spawn.cx, spawn.cy, this.classType);
        this.remotePlayer = new Player(spawn.cx, spawn.cy, 'warrior');
        
        document.getElementById('player-class-label').innerText = this.classType.toUpperCase();
        
        if (isHost) {
            this.running = true;
            requestAnimationFrame(() => this.loop());
        }
    }

    spawnEntities() {
        this.enemies = [];
        this.items = [];
        // Pula a sala 0 (spawn)
        for (let i = 1; i < this.mapData.rooms.length; i++) {
            let room = this.mapData.rooms[i];
            if (i === this.mapData.rooms.length - 1) {
                this.enemies.push(new Enemy(room.cx, room.cy, true)); // Boss
            } else {
                this.enemies.push(new Enemy(room.cx, room.cy, false)); // Mob
                if(Math.random() > 0.5) this.items.push({x: room.cx+1, y: room.cy, char: '+', color: '#2ecc71', type: 'heal'});
            }
        }
    }

    handleNetworkData(data) {
        if (data.type === 'INIT') {
            this.mapData = { grid: data.map };
            this.enemies = data.enemies.map(e => Object.assign(new Enemy(), e));
            
            // Acha um chao livre pro cliente nascer
            let spawned = false;
            for(let y=0; y<CONFIG.MAP_H && !spawned; y++) {
                for(let x=0; x<CONFIG.MAP_W; x++) {
                    if(this.mapData.grid[y][x] === '.') {
                        this.localPlayer.x = x; this.localPlayer.y = y;
                        this.remotePlayer.x = x; this.remotePlayer.y = y;
                        spawned = true; break;
                    }
                }
            }
            this.running = true;
            requestAnimationFrame(() => this.loop());
        } else if (data.type === 'SYNC') {
            this.remotePlayer.x = data.x;
            this.remotePlayer.y = data.y;
            this.remotePlayer.hp = data.hp;
            this.remotePlayer.type = data.cType;
            if(data.enemies) this.enemies = data.enemies; // Host dita os inimigos
            if(data.atk) this.drawAtk(data.atk.x, data.atk.y);
        }
    }

    initInput() {
        const setKey = (k, v) => this.keys[k] = v;
        window.addEventListener('keydown', e => setKey(e.key.toLowerCase(), true));
        window.addEventListener('keyup', e => setKey(e.key.toLowerCase(), false));
        
        const bindBtn = (id, key) => {
            const btn = document.getElementById(id);
            if(!btn) return;
            btn.addEventListener('pointerdown', e => { e.preventDefault(); setKey(key, true); });
            btn.addEventListener('pointerup', e => { e.preventDefault(); setKey(key, false); });
            btn.addEventListener('pointerleave', e => { e.preventDefault(); setKey(key, false); });
        };
        
        bindBtn('up', 'arrowup'); bindBtn('down', 'arrowdown'); 
        bindBtn('left', 'arrowleft'); bindBtn('right', 'arrowright');
        bindBtn('btn-atk', 'z'); bindBtn('btn-skill', 'x');
    }

    resize() {
        this.canvas.width = window.innerWidth > 800 ? 800 : window.innerWidth;
        this.canvas.height = window.innerWidth > 800 ? 520 : window.innerHeight - 80;
        this.ctx.font = CONFIG.FONT;
    }

    update() {
        if (this.localPlayer.hp <= 0) return;

        // Movimento Grid-based (com cooldown)
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
                
                if (this.mapData.grid[ny][nx] !== '#') {
                    this.localPlayer.x = nx;
                    this.localPlayer.y = ny;
                    
                    // Lava damage
                    if(this.mapData.grid[ny][nx] === '~') this.localPlayer.hp -= 5;
                    
                    // Pegar item
                    this.items = this.items.filter(i => {
                        if(i.x === nx && i.y === ny) {
                            if(i.type === 'heal') this.localPlayer.hp = Math.min(this.localPlayer.maxHp, this.localPlayer.hp + 30);
                            return false; // Remove map
                        }
                        return true;
                    });
                }
                this.localPlayer.moveDelay = 8; // Velocidade do andar
            }
        }

        // Combate
        if (this.localPlayer.atkDelay > 0) this.localPlayer.atkDelay--;
        let atkPos = null;
        if (this.keys['z'] && this.localPlayer.atkDelay === 0) {
            let tx = this.localPlayer.x + this.localPlayer.dir.x;
            let ty = this.localPlayer.y + this.localPlayer.dir.y;
            atkPos = {x: tx, y: ty};
            
            // Checa acerto em inimigo
            this.enemies.forEach(e => {
                if(e.x === tx && e.y === ty) e.hp -= (this.localPlayer.type === 'warrior' ? 20 : 10);
            });
            
            this.drawAtk(tx, ty);
            this.localPlayer.atkDelay = 20;
        }

        // Host atualiza IA
        if (this.network.isHost) {
            this.enemies = this.enemies.filter(e => e.hp > 0);
            this.enemies.forEach(e => e.update(this.mapData.grid, this.localPlayer, this.remotePlayer));
        }

        // Sincroniza P2P
        let syncData = { 
            type: 'SYNC', 
            x: this.localPlayer.x, y: this.localPlayer.y, 
            hp: this.localPlayer.hp, cType: this.classType,
            atk: atkPos 
        };
        if(this.network.isHost) syncData.enemies = this.enemies;
        this.network.send(syncData);

        // UI
        let hpPct = Math.max(0, (this.localPlayer.hp / this.localPlayer.maxHp) * 100);
        document.getElementById('hp-fill').style.width = hpPct + "%";
    }

    drawAtk(tx, ty) {
        // Efeito visual rápido direto no loop
        this.ctx.fillStyle = "rgba(255, 255, 0, 0.5)";
        let offX = (this.localPlayer.x * CONFIG.TILE_SIZE) - this.canvas.width/2;
        let offY = (this.localPlayer.y * CONFIG.TILE_SIZE) - this.canvas.height/2;
        this.ctx.fillRect((tx*CONFIG.TILE_SIZE)-offX, (ty*CONFIG.TILE_SIZE)-offY, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
    }

    draw() {
        this.ctx.fillStyle = CONFIG.TILE_SIZE;
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Camera centralizada
        let offX = (this.localPlayer.x * CONFIG.TILE_SIZE) - (this.canvas.width / 2) + (CONFIG.TILE_SIZE/2);
        let offY = (this.localPlayer.y * CONFIG.TILE_SIZE) - (this.canvas.height / 2) + (CONFIG.TILE_SIZE/2);

        this.ctx.font = CONFIG.FONT;
        this.ctx.textBaseline = "bottom";

        // Render Mapa (Viewport Optimization)
        let startCol = Math.max(0, Math.floor(offX / CONFIG.TILE_SIZE));
        let endCol = Math.min(CONFIG.MAP_W, startCol + Math.ceil(this.canvas.width / CONFIG.TILE_SIZE) + 1);
        let startRow = Math.max(0, Math.floor(offY / CONFIG.TILE_SIZE));
        let endRow = Math.min(CONFIG.MAP_H, startRow + Math.ceil(this.canvas.height / CONFIG.TILE_SIZE) + 1);

        for (let y = startRow; y < endRow; y++) {
            for (let x = startCol; x < endCol; x++) {
                let char = this.mapData.grid[y][x];
                if (char === '#') this.ctx.fillStyle = '#555';
                else if (char === '.') this.ctx.fillStyle = '#222';
                else if (char === '~') this.ctx.fillStyle = '#e67e22';
                
                this.ctx.fillText(char, (x * CONFIG.TILE_SIZE) - offX, (y * CONFIG.TILE_SIZE) - offY + CONFIG.TILE_SIZE);
            }
        }

        // Render Items & Entities
        this.items.forEach(i => {
            this.ctx.fillStyle = i.color;
            this.ctx.fillText(i.char, (i.x * CONFIG.TILE_SIZE) - offX, (i.y * CONFIG.TILE_SIZE) - offY + CONFIG.TILE_SIZE);
        });
        
        this.enemies.forEach(e => e.draw(this.ctx, offX, offY));
        if(this.remotePlayer && this.remotePlayer.hp > 0) this.remotePlayer.draw(this.ctx, offX, offY);
        if(this.localPlayer.hp > 0) this.localPlayer.draw(this.ctx, offX, offY);
        else {
            this.ctx.fillStyle = 'red';
            this.ctx.fillText("VOCÊ MORREU", this.canvas.width/2 - 100, this.canvas.height/2);
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
                
