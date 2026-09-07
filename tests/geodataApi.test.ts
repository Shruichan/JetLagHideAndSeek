import { beforeEach, expect, test, vi } from "vitest";

const cacheFetch = vi.hoisted(() => vi.fn());
vi.mock("@/maps/api/cache", () => ({ cacheFetch }));
import {
    fetchGeodataFeatures,
    fetchElevationRegions,
} from "@/maps/api/jetlagGeodata";
import { memoizeAsync } from "@/lib/memoizeAsync";

beforeEach(() => cacheFetch.mockReset());

test.each([
    { type: "FeatureCollection", features: [] },
    { type: "FeatureCollection", features: [], complete: false },
])("refuses an old or partial API response", async (body) => {
    cacheFetch.mockResolvedValue(Response.json(body));
    await expect(
        fetchGeodataFeatures("museum", [0, 0, 1, 1], 0, 0),
    ).rejects.toThrow("incomplete");
});

test("requests complete coverage without rounding the play boundary inward", async () => {
    cacheFetch.mockResolvedValue(
        Response.json({
            type: "FeatureCollection",
            features: [],
            complete: true,
        }),
    );
    await fetchGeodataFeatures("peak", [0.000001, 0, 2, 1, 1, 5], 0, 0);
    const url = new URL(cacheFetch.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1/peaks");
    expect(url.searchParams.get("bbox")).toBe("0.000001,0,1,1");
    expect(url.searchParams.get("complete")).toBe("1");
    expect(cacheFetch.mock.calls[0][3]).toBeInstanceOf(AbortSignal);
});

test("missing elevation fields are an error, not an empty region", async () => {
    cacheFetch.mockResolvedValue(Response.json({}));
    await expect(fetchElevationRegions([0, 0, 1, 1], 0, 0)).rejects.toThrow(
        "unavailable",
    );
});

test("pending requests are shared and rejected promises are evicted", async () => {
    const fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue("ready");
    const get = memoizeAsync(fetch, () => "same");
    const first = get();
    expect(get()).toBe(first);
    await expect(first).rejects.toThrow("offline");
    expect(await get()).toBe("ready");
    expect(fetch).toHaveBeenCalledTimes(2);
});
