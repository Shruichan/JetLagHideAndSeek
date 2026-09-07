import * as turf from "@turf/turf";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
    overpass: vi.fn(),
    elevation: vi.fn(),
    street: vi.fn(),
    legacy: false,
    hider: false as false | { latitude: number; longitude: number },
}));
vi.mock("@/lib/context", () => ({
    hiderMode: { get: () => mocks.hider },
    mapGeoJSON: {
        get: () => turf.featureCollection([turf.bboxPolygon([0, 0, 10, 10])]),
    },
    mapGeoLocation: { get: () => "test-area" },
    polyGeoJSON: { get: () => null },
    trainStations: { get: () => [] },
    useLegacyDataSources: { get: () => mocks.legacy },
    questionModified: vi.fn(),
}));
vi.mock("@/maps/api", () => ({
    fetchElevationRegions: mocks.elevation,
    fetchGeodataFeatures: mocks.fetch,
    fetchStreetRegion: mocks.street,
    findPlacesInZone: mocks.overpass,
    LOCATION_FIRST_TAG: { museum: "tourism" },
    prettifyLocation: (type: string) => type,
}));
vi.mock("react-toastify", () => ({ toast: { error: vi.fn() } }));

import {
    adjustPerMeasuring,
    determineMeasuringBoundary,
    hiderifyMeasuring,
} from "@/maps/questions/measuring";
import { determineMatchingBoundary } from "@/maps/questions/matching";

let latitude = 1;
const question = (type = "elevation") =>
    ({
        type,
        lat: latitude++,
        lng: 1,
        hiderCloser: true,
        drag: true,
        collapsed: false,
        hidden: false,
        color: "blue",
    }) as any;
const map = turf.featureCollection([turf.bboxPolygon([0, 0, 10, 10])]);

beforeEach(() => {
    vi.clearAllMocks();
    mocks.legacy = false;
    mocks.hider = false;
});

test("an empty higher region eliminates all ground for a higher answer", async () => {
    mocks.elevation.mockResolvedValue({ higher: null, lower: map.features[0] });
    const q = question();
    expect(await adjustPerMeasuring(q, map)).toBeNull();
    q.hiderCloser = false;
    expect(turf.area(await adjustPerMeasuring(q, map))).toBeCloseTo(
        turf.area(map),
    );
});

test("lower uses the supplied lower region rather than including unknown ground", async () => {
    const lower = turf.bboxPolygon([0, 0, 2, 2]);
    mocks.elevation.mockResolvedValue({
        higher: turf.bboxPolygon([5, 5, 10, 10]),
        lower,
    });
    const q = question();
    q.hiderCloser = false;
    expect(turf.area(await adjustPerMeasuring(q, map))).toBeCloseTo(
        turf.area(lower),
    );
});

test("a temporary elevation failure can retry at the same point", async () => {
    mocks.elevation
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ higher: map.features[0], lower: null });
    const q = question();
    await expect(adjustPerMeasuring(q, map)).rejects.toThrow("offline");
    expect(await adjustPerMeasuring(q, map)).not.toBeNull();
    expect(mocks.elevation).toHaveBeenCalledTimes(2);
});

test("hider mode answers lower when no higher ground exists", async () => {
    mocks.elevation.mockResolvedValue({ higher: null, lower: map.features[0] });
    mocks.hider = { latitude: 1, longitude: 1 };
    expect((await hiderifyMeasuring(question())).hiderCloser).toBe(false);
});

test("existing place questions use complete prepared data without Overpass", async () => {
    mocks.fetch.mockResolvedValue(turf.featureCollection([turf.point([1, 1])]));
    const result = await determineMeasuringBoundary(question("museum-full"));
    expect(result).toHaveLength(1);
    expect(mocks.overpass).not.toHaveBeenCalled();
});

test.each(["offline", "incomplete", "timed out"])(
    "%s prepared data falls back to Overpass",
    async (message) => {
        mocks.fetch.mockRejectedValue(new Error(message));
        mocks.overpass.mockResolvedValue({ elements: [{ lat: 1, lon: 1 }] });
        expect(
            await determineMeasuringBoundary(question("museum-full")),
        ).toHaveLength(1);
        expect(mocks.overpass).toHaveBeenCalledTimes(1);
    },
);

test("legacy mode bypasses the API", async () => {
    mocks.legacy = true;
    mocks.overpass.mockResolvedValue({ elements: [{ lat: 1, lon: 1 }] });
    await determineMeasuringBoundary(question("museum-full"));
    expect(mocks.fetch).not.toHaveBeenCalled();
});

test("each copy of a street question receives its resolved label", async () => {
    mocks.street.mockResolvedValue({
        streetName: "Main Street",
        highway: "residential",
        region: map.features[0],
    });
    const first = { ...question("street-or-path"), same: true };
    const second = { ...first };
    await determineMatchingBoundary(first);
    await determineMatchingBoundary(second);
    expect(first.street).toEqual(second.street);
    expect(second.street.name).toBe("Main Street");
});

test("prepared places outside the play polygon cannot set the measuring distance", async () => {
    mocks.fetch.mockResolvedValue(
        turf.featureCollection([turf.point([1, 1]), turf.point([20, 20])]),
    );
    const result = await determineMeasuringBoundary(question("museum-full"));
    expect((result as any)[0].geometry.coordinates).toEqual([[1, 1]]);
});

test("hider mode does not call unknown elevation lower", async () => {
    mocks.elevation.mockResolvedValue({ higher: null, lower: null });
    mocks.hider = { latitude: 1, longitude: 1 };
    await expect(hiderifyMeasuring(question())).rejects.toThrow(
        "No elevation data",
    );
});
