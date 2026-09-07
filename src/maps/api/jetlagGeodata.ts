import type {
    BBox,
    Feature,
    FeatureCollection,
    Geometry,
    GeometryCollection,
    MultiPolygon,
    Polygon,
} from "geojson";

import { cacheFetch } from "./cache";
import { JETLAG_GEODATA_API } from "./constants";
import { CacheType } from "./types";

const request = async (
    path: string,
    params: Record<string, string | number>,
) => {
    const query = new URLSearchParams(
        Object.entries({ ...params, v: "2" }).map(([key, value]) => [
            key,
            String(value),
        ]),
    );
    const response = await cacheFetch(
        `${JETLAG_GEODATA_API.replace(/\/$/, "")}/v1/${path}?${query}`,
        "Loading map data...",
        CacheType.CACHE,
        AbortSignal.timeout(20000),
    );
    const body = await response.json();
    if (!response.ok)
        throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body;
};

const queryAt = (bbox: BBox, lat: number, lng: number) => ({
    bbox: (bbox.length === 6
        ? [bbox[0], bbox[1], bbox[3], bbox[4]]
        : bbox
    ).join(","),
    lat,
    lng,
});

export const fetchGeodataFeatures = async (
    type: string,
    bbox: BBox,
    lat: number,
    lng: number,
): Promise<FeatureCollection<Exclude<Geometry, GeometryCollection>>> => {
    const paths: Record<string, string> = {
        "body-of-water": "water/features",
        motorway: "motorways",
        "highspeed-measure-shinkansen": "highspeed-rail",
        peak: "peaks",
    };
    const result = await request(paths[type] || "places", {
        ...queryAt(bbox, lat, lng),
        type,
        complete: 1,
    });
    // Older servers can return a sample with a successful status.
    if (
        result.type !== "FeatureCollection" ||
        result.complete !== true ||
        !Array.isArray(result.features)
    ) {
        throw new Error("Map data is incomplete for this area.");
    }
    return result;
};

export interface ElevationRegions {
    higher: Feature<Polygon | MultiPolygon> | null;
    lower: Feature<Polygon | MultiPolygon> | null;
}

export const fetchElevationRegions = async (
    bbox: BBox,
    lat: number,
    lng: number,
): Promise<ElevationRegions> => {
    const result = await request("elevation/regions", queryAt(bbox, lat, lng));
    if (!("higher" in result) || !("lower" in result)) {
        throw new Error("Elevation data is unavailable for this area.");
    }
    return result;
};

export const fetchStreetRegion = async (
    lat: number,
    lng: number,
    bbox: BBox,
): Promise<{
    streetName: string;
    highway: string | null;
    region: Feature<Polygon | MultiPolygon>;
}> => request("street-or-path/region", queryAt(bbox, lat, lng));

export const fetchLandmass = async (
    lat: number,
    lng: number,
): Promise<Feature<Polygon | MultiPolygon>> => {
    const result = await request("landmass", { lat, lng, snapMeters: 0 });
    return result.landmass;
};
