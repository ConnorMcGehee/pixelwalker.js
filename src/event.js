
import PocketBase from 'pocketbase'
import WebSocket from 'ws'
import { EventEmitter } from 'events'

// import { addEntity } from 'bitecs'

import { read7BitInt, deserialise } from './math.js'
import { MessageType } from './consts.js'
import { Magic, Bit7, String, Int32 } from './types.js'
import World from './world.js'

const API_ACCOUNT_LINK = 'lgso0g8.116.202.52.27.sslip.io'
const API_ROOM_LINK = 'po4swc4.116.202.52.27.sslip.io'

const ROOM_TYPE = 'pixelwalker1'

export default class Client extends EventEmitter {

    constructor(args) {
        super()

        this.pocketbase = new PocketBase(`https://${API_ACCOUNT_LINK}`)
        this.socket = null
        this.world = null

        /**
         * @type {Map<number, Player>}
         */
        this.players = new Map()

        if (args.token) {
            if (typeof args.token != 'string') throw new Error('Token should be of type string')
            this.pocketbase.authStore.save(args.token, { verified: true })
            if (!this.pocketbase.authStore.isValid) throw new Error('Invalid Token')
        }

        if (args.user && args.pass) {
            throw new Error('Authentication with user and password not supported yet.')
        }

        process.on('SIGINT', () => {
            this.disconnect()
        })
    }

    /**
     * Connect client to server
     */
    async connect(world_id) {
        const { token } = await this.pocketbase.send(`/api/joinkey/${ROOM_TYPE}/${world_id}`, {})
        this.socket = new WebSocket(`wss://${API_ROOM_LINK}/room/${token}`)
        this.socket.binaryType = 'arraybuffer'

        this.socket.on('message', (event) => {
            const buffer = Buffer.from(event)

            if (buffer[0] == 0x3F) { // 63
                return this.send(Magic(0x3F))
            }

            if (buffer[0] == 0x6B) { // 107
                return this.accept_event(buffer.subarray(1))
            }

            this.emit('error', [new Error(`Unknown header byte received: got ${buffer[0]}, expected 63 or 107.`)])
        })

        this.socket.on('error', (err) => {
            this.emit('err', [err])
        })

        this.on('init', this.internal_player_init)
        this.on('playerJoined', this.internal_player_join)
        this.on('playerLeft', this.internal_player_leave)
        this.on('playerMoved', this.internal_player_move)
        this.on('playerFace', this.internal_player_face)
        this.on('playerGodMode', this.internal_player_godmode)
        this.on('playerModMode', this.internal_player_modmode)
        this.on('crownTouched', this.internal_player_crown)
        this.on('crownTouched', this.internal_player_block)

        this.create_block_mappings()
    }

    /**
     * @private
     * @param {Buffer} buffer
     */
    accept_event(buffer) {
        let [event_id, offset] = read7BitInt(buffer, 0)
        const event_name = Object.entries(MessageType).find((k) => k[1] == event_id)[0]
        const data = deserialise(buffer, offset)
        this.emit(event_name, data)
    }

    /**
     * Wait in the local thread
     * @param {number | () => any} condition
     */
    async wait(condition) {
        if (condition == undefined)
            condition = 2

        if (typeof condition == 'number')
            return new Promise(res => setTimeout(res, condition))
        else if (typeof condition == 'function') {
            const binder = (res) => {
                let x = condition()
                if (x) res(x)
                else binder.bind(res)
            }

            return new Promise(res => binder(res))
        }
    }

    /**
     * Disconnect client from server
     */
    disconnect() {
        this.pocketbase.authStore.clear()
        this.socket?.close()
    }

    /**
     * Disconnect client from server
     * @private Get Block id to string mappings
     */
    async create_block_mappings() {
        const data = await fetch(`https://${API_ROOM_LINK}/mappings`)
        const text = await data.text()
        this.block_mappings = JSON.parse(text)
    }

    //
    // Internal Events
    //

    /**
     * @private
     */
    async internal_player_init([id, cuid, username, face, isAdmin, x, y, can_edit, can_god, title, plays, owner, width, height, buffer]) {
        await this.init()
        this.world = new World(width, height)

        this.players.set(id, {
            cuid, username, face, isAdmin, x: x / 16, y: y / 16, god_mode: false, mod_mode: false, has_crown: false
        })

        this.world.init(buffer)

        this.emit('start', [id])
    }

    /**
     * @private
     */
    internal_player_join([id, cuid, username, face, isAdmin, x, y, god_mode, mod_mode, has_crown]) {
        this.players.set(id, {
            cuid, username, face, isAdmin, x: x / 16, y: y / 16, god_mode, mod_mode, has_crown
        })
    }

    /**
     * @private
     */
    internal_player_leave([id]) {
        this.players.delete(id)
    }

    /**
     * @private
     */
    async internal_player_move([id, x, y, speed_x, speed_y, mod_x, mod_y, horizontal, vertical, space_down, space_just_down, tick_id, coins, blue_coins]) {
        let player = await this.wait(() => this.players.get(id))

        if (player.coins != undefined && player.coins != coins)
            this.emit('coinCollected', [id, coins])

        if (player.blue_coins != undefined && player.blue_coins != blue_coins)
            this.emit('blueCoinCollected', [id, blue_coins])

        player.coins = coins
        player.blue_coins = blue_coins

        player.x = x / 16
        player.y = y / 16
    }

    /**
     * @private
     */
    internal_player_face([id, face]) {
        this.players.get(id).face = face
    }

    /**
     * @private
     */
    async internal_player_godmode([id, god_mode]) {
        await this.wait(() => this.players.get(id))
        this.players.get(id).god_mode = god_mode
    }

    /**
     * @private
     */
    async internal_player_modmode([id, mod_mode]) {
        await this.wait(() => this.players.get(id))
        this.players.get(id).mod_mode = mod_mode
    }

    /**
     * @private
     */
    async internal_player_crown([id]) {
        await this.wait(() => this.players.get(id))
        this.players.forEach((p) => p.has_crown = p.id == id)
    }

    /**
     * @private
     */
    async internal_player_block([x, y, layer, id]) {
        await this.wait(() => this.world)
        this.world.place(x, y, layer, id)
    }

    //
    // Communication
    //

    /**
     * @param  {...Buffer} args 
     * @returns {Promise<boolean>} True, if socket was disconnected and message was not sent.
     */
    async send(...args) {
        return new Promise((res, rej) => {
            if (!this.socket) return true
            const buffer = Buffer.concat(args)
            this.socket.send(buffer, (err) => {if (err) rej(err); else res(true)})
            // this.socket.send(buffer, (err) => this.emit('error', err))
        })
    }

    /**
     * @public
     * Respond to the init protocol
     */
    async init() {
        await this.send(Magic(0x6B), Bit7(MessageType['init']))
    }

    /**
     * @public
     * @param {string} content 
     */
    say(content) {
        this.send(Magic(0x6B), Bit7(MessageType['chatMessage']), String(content))
    }

    /**
     * @public
     * @param {number} x 
     * @param {number} y
     * @param {number} layer
     * @param {number | string} id Numeric Id or string name
     */
    async block(x, y, layer, id) {
        if (typeof id == 'string') {
            this.wait(() => this.block_mappings)
            id = this.block_mappings[id]
        }

        await this.send(Magic(0x6B), Bit7(MessageType['placeBlock']), Int32(x), Int32(y), Int32(layer), Int32(id))
    }

}
