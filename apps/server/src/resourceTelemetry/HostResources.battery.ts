export function parseMacBattery(output: string) {
  const battery = /^\s*-InternalBattery[^\n]*?\s(\d+)%;\s*([^;\n]+)/m.exec(output);
  if (!battery) return null;
  const percent = Number(battery[1]);
  if (percent < 0 || percent > 100) return null;
  const state = battery[2]?.trim();
  return {
    percent,
    charging:
      state === "charging" ? true : state === "discharging" || state === "charged" ? false : null,
  };
}
