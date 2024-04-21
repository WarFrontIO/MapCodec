import {StreamReader} from "./util/StreamReader";

class MapDecoder {
	/**
	 * Reads compressed map data from a reader
	 * @param reader reader to use
	 * @param width map width
	 * @param height map height
	 * @returns decompressed map data
	 */
	readCompressed(reader: StreamReader, width: number, height: number): Uint16Array {
		reader.readBits(2); //reserved for future use
		const direction = reader.readBoolean(); //false if left-to-right, true if top-to-bottom
		reader.readBits(1); //reserved for future use

		const typeMap = this.readTypeMap(reader);

		const positionLength = Math.ceil(Math.log2(width * height));
		const typeLength = Math.ceil(Math.log2(typeMap.length));

		const result = new Uint16Array(width * height);
		const valueMap: boolean[] = [];
		this.putLines(reader, result, valueMap, width, typeLength, typeMap, positionLength);
		if (direction) {
			this.fillLinesTopToBottom(result, valueMap, width);
		} else {
			this.fillLinesLeftToRight(result, valueMap);
		}
		return result;
	}

	/**
	 * Reads the type map
	 * @param reader reader to use
	 * @returns type map
	 * @private
	 */
	private readTypeMap(reader: StreamReader): number[] {
		const typeMapLength = reader.readBits(16);
		const typeMap = [];
		for (let i = 0; i < typeMapLength; i++) {
			reader.readBits(3); //reserved for future use
			typeMap.push(reader.readBits(16));
		}
		return typeMap;
	}

	/**
	 * Reads compressed lines and writes them to the result array
	 * @param reader reader to use
	 * @param result array to write to
	 * @param valueMap map of values that have already been written
	 * @param width map width
	 * @param typeLength length of type ids
	 * @param typeMap map of zone type ids to game type ids
	 * @param positionLength length of position ids
	 * @private
	 */
	private putLines(reader: StreamReader, result: Uint16Array, valueMap: boolean[], width: number, typeLength: number, typeMap: number[], positionLength: number) {
		const lineCount = reader.readBits(32);
		for (let i = 0; i < lineCount; i++) {
			reader.readBits(2); //reserved for future use
			const length = reader.readBits(8) + 1;
			const type = typeMap[reader.readBits(typeLength)];
			let position = reader.readBits(positionLength);
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