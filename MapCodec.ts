import {mapEncoder} from "./src/MapEncoder";
import {LazyWriter} from "./src/util/LazyWriter";
import {StreamReader} from "./src/util/StreamReader";
import {mapDecoder} from "./src/MapDecoder";

// Only bump this for breaking changes, decompression should always be backwards compatible
const CURRENT_VERSION = 0;

/**
 * Compresses map data
 * @param data map data to compress
 * @returns binary data
 */
export function encodeMap(data: RawMapData): Uint8Array {
	const writer = new LazyWriter();

	writer.writeBits(4, CURRENT_VERSION);
	writer.writeBits(16, data.width);
	writer.writeBits(16, data.height);
	console.log(data.width, data.height);
	mapEncoder.writeCompressed(writer, data);

	return writer.compress();
}

/**
 * Decompresses map data
 * @param data binary data
 * @returns raw map data
 */
export function decodeMap(data: Uint8Array): RawMapData {
	const reader = new StreamReader(data);

	const version = reader.readBits(4);
	if (version !== CURRENT_VERSION) {
		throw `Unsupported map version: ${version}`;
	}

	const width = reader.readBits(16);
	const height = reader.readBits(16);
	console.log(width, height);
	const tiles = mapDecoder.readCompressed(reader, width, height);

	return {width, height, tiles};
}

export interface RawMapData {
	width: number;
	height: number;
	/** 1D array of tile types */
	tiles: Uint16Array;
}