
import { BlockMappings, BlockMappingsReverse } from "./mappings"

export default class Block {
    private client // TODO
    public id: number
    
    constructor(id: number | string) {
        if (typeof id == 'string') {
            id = BlockMappings[id]
        }
        this.id = id
    }

    get name() {
        return BlockMappingsReverse[this.id]
    }

    public async place(x: number, y: number, l: number) {
        // TODO 
    }
}