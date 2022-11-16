import {
    HindenburgPlugin,
    RoomPlugin,
    EventListener,
    PlayerJoinEvent,
    PlayerLeaveEvent,
    PlayerSetNameEvent,
    PlayerDieEvent,
    PlayerStartMeetingEvent,
    RoomGameStartEvent,
    RoomGameEndEvent,
    MeetingHudVotingCompleteEvent,
    Room,
    GameCode,
    PlayerSetColorEvent
} from "@skeldjs/hindenburg";
import { Server } from "socket.io";

export interface DiscordAutoMutePluginConfig {
    message: string;
}
import mariadb from 'mariadb';
import { positional } from "yargs";
import fs from 'fs';
import path from 'path';

let config;
try {
    const filePath = path.resolve(__dirname, 'config.json');
    const fileJson = fs.readFileSync(filePath, 'utf-8');
    config = JSON.parse(fileJson);
} catch (ex: any) {
    console.error(`Config file reading error. ${ex.message}`);
    process.exit(1);
}

const HINDENBURG_MYSQL_DATABASE = config.MYSQL_DATABASE
const HINDENBURG_MYSQL_USER = config.MYSQL_USER
const HINDENBURG_MYSQL_PASSWORD = config.MYSQL_PASSWORD
const HINDENBURG_MYSQL_HOST = config.MYSQL_HOST
const HINDENBURG_MYSQL_PORT = Number(config.MYSQL_PORT)
const JWT = config.JWT

const isValidJwt = (header: string) => {
    const token = header.split(' ')[1];
    if (token === JWT) {
      return true;
    } else {
      return false;
    }
};

const pool = mariadb.createPool({
    host: HINDENBURG_MYSQL_HOST,
    user: HINDENBURG_MYSQL_USER,
    password: HINDENBURG_MYSQL_PASSWORD,
    database: HINDENBURG_MYSQL_DATABASE, 
    port: HINDENBURG_MYSQL_PORT,
    connectionLimit: 5
});

async function createTables() {
    let conn;
    try {
        conn = await pool.getConnection();
        let sql = `CREATE TABLE IF NOT EXISTS players(
            client_id INTEGER NOT NULL,
            roomcode VARCHAR(6) NOT NULL,
            username VARCHAR(10) NOT NULL,
            color_id INTEGER,
            is_ghost BOOLEAN NOT NULL,
            is_host BOOLEAN NOT NULL,
            discord_user_id BIGINT UNSIGNED,
            discord_message_id BIGINT UNSIGNED,
            discord_voice_id BIGINT UNSIGNED,            
            PRIMARY KEY (client_id));`
        await conn.query(sql)
        sql = `DELETE FROM players`
        await conn.query(sql)
        let sql = `CREATE TABLE IF NOT EXISTS linked_players(
            client_id INTEGER NOT NULL,
            username VARCHAR(10) NOT NULL,
            discord_user_id BIGINT UNSIGNED,        
            PRIMARY KEY (client_id));`
        await conn.query(sql)
    } finally {
        if (conn) conn.release();
    }
}

async function addPlayer(client_id: number, username: string, roomcode: string) {
    let conn;
    try {
        conn = await pool.getConnection();
        let sql = `INSERT IGNORE INTO players (client_id, roomcode, username, is_ghost, is_host) VALUES(${client_id}, '${roomcode}', '${username}', FALSE, FALSE)`
        await conn.query(sql)
    } finally {
        if (conn) conn.release();
    }
}

async function removePlayer(client_id: number) {
    let conn;
    try {
        conn = await pool.getConnection();
        let sql = `DELETE FROM players WHERE client_id = ${client_id}`
        await conn.query(sql)
    } finally {
        if (conn) conn.release();
    }
}

async function updatePlayerName(client_id: number, new_username: string) {
    let conn;
    try {
        conn = await pool.getConnection();
        let sql = `UPDATE players SET username = '${new_username}' WHERE client_id = ${client_id}`
        await conn.query(sql)
    } finally {
        if (conn) conn.release();
    }
}

async function updatePlayerColor(client_id: number, color: number) {
    let conn;
    try {
        conn = await pool.getConnection();
        let sql = `UPDATE players SET color_id = '${color}' WHERE client_id = ${client_id}`
        await conn.query(sql)
    } finally {
        if (conn) conn.release();
    }
}

async function getMessageId(client_id: number) {
    let conn;
    try {
        conn = await pool.getConnection();
        let sql = `SELECT discord_message_id FROM players WHERE client_id = ${client_id}`
        const result = await conn.query(sql)
        return result
    } finally {
        if (conn) conn.release();
    }
}

async function updateIsGhost(client_id: number, is_ghost: string) {
    let conn;
    try {
        conn = await pool.getConnection();
        let sql = `UPDATE players SET is_ghost = ${is_ghost} WHERE client_id = ${client_id}`
        await conn.query(sql)
    } finally {
        if (conn) conn.release();
    }
}




const io = new Server(3000, { /* options */ });
io.use((socket, next) => {
    const header = socket.handshake.headers['authorization'];
    console.log(header)
    if (isValidJwt(header as string)) return next();
    return next(new Error('authentication error'))
});

io.on("connection", async (socket) => {
    //await createTables();
    //console.log("Tables created");
    //console.log(socket)
    socket.on("room", room => {
        console.log(room);
        socket.join(room);
    });
    socket.on("on_mute_deafen", (data) => {
        io.sockets.to("second").emit("on_mute_deafen", data)
    });
    socket.on("on_unmute_undeafen", (data) => {
        io.sockets.to("second").emit("on_unmute_undeafen", data)
    });
    socket.on("on_mute", (data) => {
        io.sockets.to("second").emit("on_mute", data)
    });
  });



@HindenburgPlugin("hbplugin-discord-auto-mute")
export class DiscordAutoMutePlugin extends RoomPlugin {
    message: string;
    

    constructor(public readonly room: Room, public config: DiscordAutoMutePluginConfig) {
        super(room, config);
        

        this.message = config.message;
    }

    onConfigUpdate(oldConfig: any, newConfig: any) {
        this.message = newConfig.message;
        this.logger.info("Updated message to '%s'!", this.message);
    }

    @EventListener("player.join")
    async onPlayerJoin(ev: PlayerJoinEvent<Room>) {
        const roomcode = GameCode.convertIntToString(ev.player.room.code)
        await addPlayer(ev.player.clientId, ev.player.username, roomcode);
        const map = new Map();
        map.set("client_id", ev.player.clientId)
        map.set("roomcode", roomcode)
        map.set("username", ev.player.username)
        io.sockets.to("main").emit("on_join", map);
    }

    @EventListener("player.leave")
    async onPlayerLeave(ev: PlayerLeaveEvent<Room>) {
        const result = await getMessageId(ev.player.clientId)
        const messageId: string = String(result[0].discord_message_id)
        console.log(messageId);
        await removePlayer(ev.player.clientId)
        const map = new Map();
        map.set("client_id", ev.player.clientId)
        map.set("message_id", messageId)
        map.set("roomcode", GameCode.convertIntToString(ev.room.code))
        map.set("username", ev.player.username)
        io.sockets.to("main").emit("on_leave", map);
    }

    @EventListener("player.setname")
    async onPlayerSetName(ev: PlayerSetNameEvent<Room>) {
        await updatePlayerName(ev.player.clientId, ev.newName)
        const roomcode = GameCode.convertIntToString(ev.player.room.code)
        const map = new Map();
        map.set("client_id", ev.player.clientId)
        map.set("roomcode", roomcode)
        map.set("username", ev.newName)
        io.sockets.to("main").emit("on_join", map);
    }        

    @EventListener("player.setcolor")
    async onPlayerSetColor(ev: PlayerSetColorEvent<Room>) {
        await updatePlayerColor(ev.player.clientId, ev.newColor)
        const roomcode = GameCode.convertIntToString(ev.player.room.code)
        const map = new Map();
        map.set("client_id", ev.player.clientId)
        map.set("roomcode", roomcode)
        map.set("username", ev.player.username)
        io.sockets.to("main").emit("on_setcolor", map);
    }

    @EventListener("room.gamestart")
    async onGameStart(ev: RoomGameStartEvent) {
        const roomcode = GameCode.convertIntToString(ev.room.code)
        io.sockets.to("main").emit("on_game_start", roomcode);
    }

    @EventListener("room.gameend")
    async onGameEnd(ev: RoomGameEndEvent) {
        const roomcode = GameCode.convertIntToString(ev.room.code)
        io.sockets.to("main").emit("on_game_end", roomcode);
    }

    @EventListener("player.die")
    async onPlayerDie(ev: PlayerDieEvent<Room>) {
        await updateIsGhost(ev.player.clientId, "TRUE")
        const roomcode = GameCode.convertIntToString(ev.room.code)
        io.sockets.to("main").emit("on_player_die", roomcode);     
    }

    @EventListener("player.startmeeting")
    async onPlayerStartMeeting(ev: PlayerStartMeetingEvent<Room>) {
        const roomcode = GameCode.convertIntToString(ev.room.code)
        io.sockets.to("main").emit("on_player_start_meeting", roomcode);
    }

    @EventListener("meeting.votingcomplete")
    async onMeetingVotingComplete(ev: MeetingHudVotingCompleteEvent<Room>) {        
        const roomcode = GameCode.convertIntToString(ev.room.code)
        io.sockets.to("main").emit("on_meeting_voting_complete", roomcode);
    }


}

