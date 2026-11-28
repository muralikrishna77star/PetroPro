/** A vehicle number reduced to capitals and digits — mirrors apps/api's vehicleKey, so the web
 *  side matches "TN 01-AB 1234" to the TN01AB1234 on file the same way the server does. */
export function vehicleKey(vehicleNo: string): string {
  return vehicleNo.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function confusable(key: string): string {
  return key.replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** One character changed, added, dropped, or two neighbours swapped. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diffs: number[] = [];
    for (let i = 0; i < a.length && diffs.length <= 2; i++) if (a[i] !== b[i]) diffs.push(i);
    if (diffs.length === 1) return true;
    return diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]];
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < shorter.length && shorter[i] === longer[i]) i++;
  return shorter.slice(i) === longer.slice(i + 1);
}

/** The vehicle on file a typed number means: an exact match, else one differing only in
 *  spaces/hyphens/case. */
export function findVehicle<T extends { vehicle_no: string }>(vehicles: T[], typed: string): T | undefined {
  const key = vehicleKey(typed);
  if (!key) return undefined;
  return vehicles.find((v) => v.vehicle_no === typed.trim()) ?? vehicles.find((v) => vehicleKey(v.vehicle_no) === key);
}

/** Vehicles on file one character away from a number that isn't on file — "did you mean". */
export function similarVehicles<T extends { vehicle_no: string }>(vehicles: T[], typed: string, limit = 3): T[] {
  const key = confusable(vehicleKey(typed));
  if (key.length < 6) return [];
  return vehicles.filter((v) => oneEditApart(confusable(vehicleKey(v.vehicle_no)), key)).slice(0, limit);
}
