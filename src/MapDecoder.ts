import type {StreamReader} from "./util/StreamReader";
import type {RawMapData, TileType} from "../MapCodec";

class MapDecoder {
	/**
	 * Reads compressed map data from a reader
	 * @param reader reader to use
	 * @param width map width
	 * @param height map height
	 * @returns decompressed map data
	 */
	readCompressed(reader: StreamReader, width: number, height: number): RawMapData {
		reader.readBits(8); //reserved for future use
		const direction = reader.readBoolean(); //false if left-to-right, true if top-to-bottom
		reader.readBits(1); //reserved for future use

		const tileTypes = this.readTypeMap(reader);

		const typeLength = Math.ceil(Math.log2(tileTypes.length));

		const result = new Uint16Array(width * height);
		const valueMap: boolean[] = [];
		this.putLines(reader, result, valueMap, width, typeLength);
		if (direction) {
			this.fillLinesTopToBottom(result, valueMap, width);
		} else {
			this.fillLinesLeftToRight(result, valueMap);
		}
		return {width, height, tiles: result, types: tileTypes};
	}

	/**
	 * Reads the type map
	 * @param reader reader to use
	 * @returns list of tile types
	 * @private
	 */
	private readTypeMap(reader: StreamReader): TileType[] {
		const typeMapLength = reader.readBits(16);
		const types = [];
		for (let i = 0; i < typeMapLength; i++) {
			reader.readBits(3); //reserved for future use
			types.push({
				name: reader.readString(32),
				colorBase: reader.readString(16),
				colorVariant: reader.readBits(4),
				conquerable: reader.readBoolean(),
				navigable: reader.readBoolean(),
				expansionTime: reader.readBits(8),
				expansionCost: reader.readBits(8)
			});
		}
		return types;
	}

	/**
	 * Reads compressed lines and writes them to the result array
	 * @param reader reader to use
	 * @param result array to write to
	 * @param valueMap map of values that have already been written
	 * @param width map width
	 * @param typeLength length of type ids
	 * @private
	 */
	private putLines(reader: StreamReader, result: Uint16Array, valueMap: boolean[], width: number, typeLength: number) {
		const lineCount = reader.readBits(32);

		let currentChunk = 0;
		for (let i = 0; i < lineCount; i++) {
			while (reader.readBoolean()) {
				currentChunk++;
			}
			reader.readBits(1); //reserved for future use
			const length = reader.readBits(8) + 1;
			const type = reader.readBits(typeLength);
			let position = reader.readBits(10);
			position = (position % 32) + (currentChunk % Math.ceil(width / 32)) * 32 + Math.floor(position / 32) * width + Math.floor(currentChunk / Math.ceil(width / 32)) * 32 * width;
			result[position] = type;
			valueMap[position] = true;
			for (let j = 1; j < length; j++) {
				const diff = reader.readBits(2);
				position += diff === 0 ? 1 : diff === 1 ? -1 : diff === 2 ? width : -width;
				result[position] = type;
				valueMap[position] = true;
			}
		}
	}

	/**
	 * Fills in the gaps in the result array
	 * @param result array to fill
	 * @param valueMap map of values that have already been written
	 * @private
	 */
	private fillLinesLeftToRight(result: Uint16Array, valueMap: boolean[]) {
		let current = 0;
		for (let i = 0; i < result.length; i++) {
			if (valueMap[i]) {
				current = result[i];
			}
			result[i] = current;
		}
	}

	/**
	 * Fills in the gaps in the result array
	 * @param result array to fill
	 * @param valueMap map of values that have already been written
	 * @param width map width
	 * @private
	 */
	private fillLinesTopToBottom(result: Uint16Array, valueMap: boolean[], width: number) {
		let current = 0;
		for (let i = 0; i < result.length - 1; i = i >= result.length - width ? (i + 1) % width : i + width) {
			if (valueMap[i]) {
				current = result[i];
			}
			result[i] = current;
		}
	}
}

export const mapDecoder = new MapDecoder();