import type {RawMapData} from "../../MapCodec";

export class ZoneCalculator {
	/**
	 * Builds zones from a map
	 * @param data raw map data
	 * @returns array of zones
	 */
	static buildZones(data: RawMapData): TileZone[] {
		const result: TileZone[] = [];

		const zoneMap: Uint16Array = new Uint16Array(data.width * data.height);

		for (let i = 0; i < data.tiles.length; i++) {
			if (!zoneMap[i]) {
				result.push(this.exploreZone(i, data.tiles, data.width, zoneMap, result.length + 1));
			}
		}
		return result;
	}

	/**
	 * Inserts a tile into the zone map
	 * @param tile index of the tile to check
	 * @param tileTypes array of tile types
	 * @param width width of the map
	 * @param zoneMap zone map
	 * @param zoneId id of the current zone
	 * @private
	 */
	private static exploreZone(tile: number, tileTypes: Uint16Array, width: number, zoneMap: Uint16Array, zoneId: number): TileZone {
		const stack: number[] = [tile];
		let stackPointer = 1;
		const leftBorder = [];
		const leftBorderMap = [];
		const topBorder = [];
		const topBorderMap = [];
		while (stackPointer > 0) {
			const current = stack[--stackPointer];
			if (zoneMap[current]) continue;
			zoneMap[current] = zoneId;
			if (current % width !== 0 && tileTypes[current - 1] === tileTypes[current]) stack[stackPointer++] = current - 1;
			else if (!leftBorderMap[current]) {
				leftBorder.push(current);
				leftBorderMap[current] = true;
			}
			if (current % width !== width - 1 && tileTypes[current + 1] === tileTypes[current]) stack[stackPointer++] = current + 1;
			if (current >= width && tileTypes[current - width] === tileTypes[current]) stack[stackPointer++] = current - width;
			else if (!topBorderMap[current]) {
				topBorder.push(current);
				topBorderMap[current] = true;
			}
			if (current < tileTypes.length - width && tileTypes[current + width] === tileTypes[current]) stack[stackPointer++] = current + width;
		}
		return {id: tileTypes[tile], tileMap: zoneMap, leftBorder, leftBorderMap, topBorder, topBorderMap};
	}
}

export type TileZone = {
	/** Tile type of the zone */
	id: number;
	tileMap: Uint16Array;
	leftBorder: number[];
	leftBorderMap: boolean[];
	topBorder: number[];
	topBorderMap: boolean[];
}