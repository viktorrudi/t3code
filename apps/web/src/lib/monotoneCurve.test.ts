import { describe, expect, it } from "vite-plus/test";

import { curvePath, smoothCurve } from "./monotoneCurve";

describe("monotone chart curve", () => {
  it("preserves Usage path output and holds flat and turning segments inside their endpoints", () => {
    expect(
      curvePath(
        smoothCurve([
          { x: 0, y: 0 },
          { x: 3, y: 3 },
        ]),
      ),
    ).toBe("M0.00,0.00 C1.00,1.00 2.00,2.00 3.00,3.00");
    for (const segment of smoothCurve([
      { x: 0, y: 0 },
      { x: 2, y: 100 },
      { x: 4, y: 100 },
      { x: 8, y: 5 },
      { x: 9, y: 50 },
    ])) {
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20;
        const u = 1 - t;
        const value =
          u ** 3 * segment.from.y +
          3 * u ** 2 * t * segment.c1.y +
          3 * u * t ** 2 * segment.c2.y +
          t ** 3 * segment.to.y;
        expect(value).toBeGreaterThanOrEqual(Math.min(segment.from.y, segment.to.y) - 1e-9);
        expect(value).toBeLessThanOrEqual(Math.max(segment.from.y, segment.to.y) + 1e-9);
      }
    }
    expect(curvePath(smoothCurve([]))).toBe("");
    expect(curvePath(smoothCurve([{ x: 1, y: 0 }]))).toBe("");
  });
});
