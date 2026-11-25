import { expect, it } from "vite-plus/test";
import { parseMacBattery } from "./HostResources.battery.ts";

it("reads only a valid internal battery and preserves unknown charging state", () => {
  expect(
    parseMacBattery(
      "Now drawing from 'AC Power'\n -InternalBattery-0 (id=123) 87%; charging; 0:24 remaining present: true",
    ),
  ).toEqual({ percent: 87, charging: true });
  expect(parseMacBattery(" -InternalBattery-0 (id=123) 9%; discharging; 1:00 remaining")).toEqual({
    percent: 9,
    charging: false,
  });
  expect(parseMacBattery(" -InternalBattery-0 (id=123) 100%; charged; 0:00 remaining")).toEqual({
    percent: 100,
    charging: false,
  });
  expect(
    parseMacBattery(" -InternalBattery-0 (id=123) 75%; finishing charge; 0:00 remaining"),
  ).toEqual({ percent: 75, charging: null });
  for (const output of [
    "Now drawing from 'AC Power'",
    "UPS 30%; charging",
    " -InternalBattery-0 101%; charging",
  ])
    expect(parseMacBattery(output)).toBeNull();
});
