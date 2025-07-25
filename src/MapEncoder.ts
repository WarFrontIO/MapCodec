import type {RawMapData, TileType} from "../MapCodec";
import type {LazyWriter} from "./util/LazyWriter";
import type {TileZone} from "./util/ZoneCalculator";
import {ZoneCalculator} from "./util/ZoneCalculator";
import {CodecException} from "./util/CodecException";

class MapEncoder {
	width: number = 0;

	/**
	 * Writes compressed map data to a writer
	 * @param writer writer to use
	 * @param data map data to compress
	 * @throws CodecException if map couldn't be compressed
	 */
	writeCompressed(writer: LazyWriter, data: RawMapData): void {
		writer.writeBits(8, 0); //reserved for future use
		this.width = data.width;

		const zones = ZoneCalculator.buildZones(data);

		const types = this.validateTileTypeUsage(data.types, zones);
		const typeLength = Math.ceil(Math.log2(types.length));

		const lines = this.calculateLines(writer, zones, typeLength);

		writer.writeBits(1, 0); //reserved for future use

		this.writeTypeMap(writer, data.types);
		this.writeLines(writer, lines, typeLength);
	}

	/**
	 * Writes the type map, note that type ids are limited to 16 bits
	 * @param writer writer to use
	 * @param typeMap map of zone type ids to game type ids
	 * @private
	 */
	private writeTypeMap(writer: LazyWriter, typeMap: TileType[]) {
		writer.writeBits(16, typeMap.length);
		for (let i = 0; i < typeMap.length; i++) {
			writer.writeBits(3, 0); //reserved for future use
			writer.writeString(32, typeMap[i].name);
			writer.writeString(16, typeMap[i].colorBase);
			writer.writeBits(4, typeMap[i].colorVariant);
			writer.writeBoolean(typeMap[i].conquerable);
			writer.writeBoolean(typeMap[i].navigable);
			writer.writeBits(8, typeMap[i].expansionTime);
			writer.writeBits(8, typeMap[i].expansionCost);
		}
	}

	/**
	 * Writes compressed lines
	 * @param writer writer to use
	 * @param lines map lines to write
	 * @param typeLength length of type ids
	 * @private
	 */
	private writeLines(writer: LazyWriter, lines: LineData[], typeLength: number) {
		writer.writeBits(32, lines.length);

		let currentChunk = 0;
		for (const line of lines) {
			currentChunk = this.checkChunk(writer, currentChunk, line.line[0]);
			writer.writeBits(1, 0); //reserved for future use
			writer.writeBits(8, line.line.length - 1);
			writer.writeBits(typeLength, line.id);
			writer.writeBits(10, (line.line[0] % this.width) % 32 + Math.floor(line.line[0] / this.width) % 32 * 32);
			for (let i = 1; i < line.line.length; i++) {
				const diff = line.line[i] - line.line[i - 1];
				writer.writeBits(2, diff === 1 ? 0 : diff === -1 ? 1 : diff === this.width ? 2 : 3);
			}
		}
	}

	/**
	 * Checks if the current chunk needs to be changed
	 * @param writer writer to use
	 * @param currentChunk current chunk
	 * @param position position to check
	 * @returns new chunk
	 * @private
	 */
	private checkChunk(writer: LazyWriter, currentChunk: number, position: number): number {
		const chunkX = Math.floor((position % this.width) / 32);
		const chunkY = Math.floor(Math.floor(position / this.width) / 32);
		const chunk = chunkY * Math.ceil(this.width / 32) + chunkX;
		while (chunk !== currentChunk) {
			writer.writeBits(1, 1);
			currentChunk++;
		}
		writer.writeBits(1, 0);
		return currentChunk;
	}

	/**
	 * Validates that all and only known tile types are used in the map
	 * @param types tile types to validate
	 * @param zones zones to validate
	 * @returns list of used tile types
	 * @private
	 */
	private validateTileTypeUsage(types: TileType[], zones: TileZone[]): TileType[] {
		const tileUsage: TileZone[][] = Array(types.length).fill(null).map(() => []);
		for (const zone of zones) {
			if (!types[zone.id]) {
				throw new CodecException(`Unknown tile type: ${zone.id}. Not specified in type map`);
			}
			tileUsage[zone.id].push(zone);
		}

		const usedTypes = [];
		for (let i = 0; i < types.length; i++) {
			if (tileUsage[i].length > 0) {
				usedTypes.push(types[i]);
				tileUsage[i].forEach(zone => zone.id = usedTypes.length - 1);
			}
		}
		return usedTypes;
	}

	/**
	 * Chunks lines into 32x32 blocks
	 * @param lines lines to chunk
	 * @private
	 */
	private chunkLines(lines: LineData[]) {
		const chunkWidth = Math.ceil(this.width / 32);
		const chunkMap: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const chunkX = Math.floor((line.line[0] % this.width) / 32);
			const chunkY = Math.floor(Math.floor(line.line[0] / this.width) / 32);
			chunkMap[i] = chunkY * chunkWidth + chunkX;
		}
		lines.sort((a, b) => chunkMap[lines.indexOf(a)] - chunkMap[lines.indexOf(b)]);
	}

	/**
	 * Calculates lines along the border of each zone
	 * @param writer writer to use
	 * @param zones zones to calculate lines for
	 * @param typeLength length of type ids
	 * @returns resulting lines
	 * @private
	 */
	private calculateLines(writer: LazyWriter, zones: TileZone[], typeLength: number): LineData[] {
		const linesL2R: LineData[] = [];
		const linesT2B: LineData[] = [];
		for (let zoneId = 0; zoneId < zones.length; zoneId++) {
			const zone = zones[zoneId];
			linesL2R.push(...this.calculateNeededLines(zone.leftBorder, zone.leftBorderMap, zoneId + 1, zone.tileMap).map(line => ({id: zone.id, line})));
			linesT2B.push(...this.calculateNeededLines(zone.topBorder, zone.topBorderMap, zoneId + 1, zone.tileMap).map(line => ({id: zone.id, line})));
		}

		this.chunkLines(linesL2R);
		this.chunkLines(linesT2B);

		const costL2R = this.calculateCost(linesL2R, typeLength);
		const costT2B = this.calculateCost(linesT2B, typeLength);
		writer.writeBoolean(costL2R > costT2B);
		return costL2R > costT2B ? linesT2B : linesL2R;
	}

	/**
	 * Calculates the cost of a set of lines
	 * @param lines lines to calculate cost for
	 * @param typeLength length of type ids
	 * @returns cost of the lines
	 * @private
	 */
	private calculateCost(lines: LineData[], typeLength: number): number {
		let cost = 0;

		let currentChunk = 0;
		for (const line of lines) {
			const chunk = Math.floor((line.line[0] % this.width) / 32) + Math.floor(Math.floor(line.line[0] / this.width) / 32) * Math.ceil(this.width / 32);
			cost += (line.line.length - 1) * 2 + 20 + typeLength + (chunk - currentChunk);
			currentChunk = chunk;
		}
		return cost;
	}

	/**
	 * Finds lines along the border of a zone allowing for lossless compression
	 *
	 * To allow reconstruction of the map, only certain points on the borders are needed.
	 * Since the overhead of storing positions is pretty high, we can compress the border into lines.
	 * This greedy algorithm tries to find the shortest possible lines that connect all border points.
	 * For gaps greater than 8 tiles, multiple lines are used.
	 *
	 * @param points border points
	 * @param pointMap map of border points
	 * @param zoneId id of the zone
	 * @param tileMap map of tiles
	 * @returns resulting lines
	 * @private
	 */
	private calculateNeededLines(points: number[], pointMap: boolean[], zoneId: number, tileMap: Uint16Array): number[][] {
		const segments: number[][] = [];
		const segmentMap: number[] = [];

		const connectionCount = new Uint8Array(points.length);
		const connectionMap = this.calculateConnections(points, pointMap, zoneId, tileMap);

		for (let depth = 0; depth < connectionMap.length; depth++) {
			for (const connection of connectionMap[depth]) {
				if (connectionCount[connection.from] >= 2 || connectionCount[connection.to] >= 2) {
					continue;
				}

				if (!MapEncoder.processConnection(!connectionCount[connection.from], !connectionCount[connection.to], connection, segments, points, segmentMap)) {
					continue;
				}

				connectionCount[connection.from]++;
				connectionCount[connection.to]++;
			}
		}

		MapEncoder.cropLines(segments);
		MapEncoder.addSingles(points, connectionCount, segments);

		return segments.filter(segment => segment.length > 0);
	}

	/**
	 * Processes a connection between two border points
	 * @param fromIsNew whether the starting point is new
	 * @param toIsNew whether the ending point is new
	 * @param connection connection to process
	 * @param segments lines to add to
	 * @param border border points
	 * @param segmentMap map of border points to segments
	 * @returns whether the segments were connected
	 * @private
	 */
	private static processConnection(fromIsNew: boolean, toIsNew: boolean, connection: RawLineData, segments: number[][], border: number[], segmentMap: number[]): boolean {
		const valueFrom = border[connection.from];
		const valueTo = border[connection.to];
		if (fromIsNew && toIsNew) {
			segments.push([valueFrom, ...connection.path, valueTo]);
			segmentMap[connection.from] = segmentMap[connection.to] = segments.length - 1;
			return true;
		}

		if (fromIsNew) {
			MapEncoder.concatSegment(segments[segmentMap[connection.to]], connection.path, valueTo, valueFrom);
			segmentMap[connection.from] = segmentMap[connection.to];
			return true;
		}

		if (toIsNew) {
			MapEncoder.concatSegment(segments[segmentMap[connection.from]], connection.path.reverse(), valueFrom, valueTo);
			segmentMap[connection.to] = segmentMap[connection.from];
			return true;
		}

		if (segmentMap[connection.from] !== segmentMap[connection.to]) {
			const start = MapEncoder.connectSegments(segments[segmentMap[connection.from]], segments[segmentMap[connection.to]], valueFrom, valueTo, connection.path);
			segments[segmentMap[connection.from]] = [];
			segmentMap[border.indexOf(start)] = segmentMap[connection.to];
			return true;
		}

		return false;
	}

	/**
	 * Concatenates a path to a segment
	 * @param segment segment to concatenate to
	 * @param path path to concatenate
	 * @param ending ending point of the segment
	 * @param toAdd point to add to the segment
	 * @private
	 */
	private static concatSegment(segment: number[], path: number[], ending: number, toAdd: number) {
		if (segment[0] === ending) {
			segment.unshift(toAdd, ...path);
		} else {
			segment.push(...path.reverse(), toAdd);
		}
	}

	/**
	 * Connects two segments into one
	 * @param segmentA first segment
	 * @param segmentB second segment
	 * @param startA starting point of the first segment
	 * @param startB starting point of the second segment
	 * @param path path to connect the segments
	 * @returns new starting value of the combined segment
	 * @private
	 */
	private static connectSegments(segmentA: number[], segmentB: number[], startA: number, startB: number, path: number[]): number {
		if (segmentB[0] === startB) {
			if (segmentA[0] === startA) {
				segmentB.unshift(...segmentA.reverse(), ...path);
			} else {
				segmentB.unshift(...segmentA, ...path);
			}
		} else {
			if (segmentA[0] === startA) {
				segmentB.push(...path.reverse(), ...segmentA);
			} else {
				segmentB.push(...path.reverse(), ...segmentA.reverse());
			}
		}
		return segmentA[0] === startA ? segmentA[segmentA.length - 1] : segmentA[0];
	}

	/**
	 * Adds lines for single points
	 * @param border border points
	 * @param connectionCount connection count for each point
	 * @param lines lines to add to
	 * @private
	 */
	private static addSingles(border: number[], connectionCount: Uint8Array, lines: number[][]) {
		for (let i = 0; i < border.length; i++) {
			if (connectionCount[i] === 0) {
				lines.push([border[i]]);
			}
		}
	}

	/**
	 * Crops lines that are too long, splitting them into multiple lines
	 * @param lines lines to crop
	 * @private
	 */
	private static cropLines(lines: number[][]) {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line && line.length > 256) {
				lines[i] = line.slice(0, 256);
				lines.push(line.slice(256));
			}
		}
	}

	/**
	 * Calculates all potential connections between border points, at most 8 pixels apart
	 * @param points border points
	 * @param pointMap map of border points
	 * @param zoneId id of the zone
	 * @param tileMap map of tiles
	 * @returns array of connections, indexed by path length
	 * @private
	 */
	private calculateConnections(points: number[], pointMap: boolean[], zoneId: number, tileMap: Uint16Array): RawLineData[][] {
		const connectionMap: RawLineData[][] = new Array(8).fill(null).map(() => []);
		for (let i = 0; i < points.length; i++) {
			const paths = this.calculatePaths(points[i], pointMap, zoneId, tileMap);
			for (const [point, path] of paths) {
				const index = points.indexOf(point);
				if (index >= i) continue; //only add each connection once
				connectionMap[path.length].push({from: i, to: index, path});
			}
		}
		return connectionMap;
	}

	/**
	 * Calculates all paths from a point to all other points
	 *
	 * This is a simple breadth-first search, paths are limited to 8 tiles
	 *
	 * @param start starting point
	 * @param pointMap map of border points
	 * @param zoneId id of the zone
	 * @param tileMap map of tiles
	 * @returns map of reachable points and their paths
	 * @private
	 */
	private calculatePaths(start: number, pointMap: boolean[], zoneId: number, tileMap: Uint16Array): Map<number, number[]> {
		const open: number[] = [start];
		const paths: number[][] = [[]];
		const visited: boolean[] = [];
		visited[start] = true;
		const result: Map<number, number[]> = new Map();
		while (open.length > 0) {
			const point = open.shift() as number;
			const path = paths.shift() as number[];
			if (pointMap[point]) {
				result.set(point, path.slice(0, -1));
			}
			if (path.length < 8) {
				for (const nextPoint of [point - 1, point + 1, point - this.width, point + this.width]) {
					if (!visited[nextPoint] && tileMap[nextPoint] === zoneId) {
						open.push(nextPoint);
						paths.push([...path, nextPoint]);
						visited[nextPoint] = true;
					}
				}
			}
		}
		return result;
	}
}

type RawLineData = {
	from: number;
	to: number;
	path: number[];
}

type LineData = {
	id: number;
	line: number[];
}

export const mapEncoder = new MapEncoder();