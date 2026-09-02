// A QR code drawn with plain Views.
//
// No react-native-svg and no image encoder: both are native modules, and adding one would
// mean rebuilding the dev client. `qrcode-generator` is pure JS with zero dependencies, so
// it works over Metro like any other module — it hands back a matrix, and this draws it.
//
// Each ROW emits one View per run of dark modules rather than one per module. A 33×33 code
// is 1089 modules but only a few hundred runs, and the difference is what keeps this from
// mounting a thousand views.
import { useMemo } from "react";
import { View } from "react-native";
import qrcode from "qrcode-generator";

/** Modules of clear margin. Four is the spec's quiet zone; below it, scanners start failing. */
const QUIET_ZONE = 4;

export default function QrCode({
  value,
  /** Overall side length in points, quiet zone included. */
  size,
  color = "#000000",
  background = "#FFFFFF",
}: {
  value: string;
  size: number;
  color?: string;
  background?: string;
}) {
  const { runs, module, count } = useMemo(() => {
    // 0 = pick the smallest version that fits. "M" corrects ~15%, the usual choice for a
    // code shown on a screen rather than printed on something that gets scuffed.
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();

    const n = qr.getModuleCount();
    const m = size / (n + QUIET_ZONE * 2);
    const found: { x: number; y: number; w: number }[] = [];

    for (let row = 0; row < n; row++) {
      let start = -1;
      for (let col = 0; col <= n; col++) {
        const dark = col < n && qr.isDark(row, col);
        if (dark && start === -1) start = col;
        // Closes on the first light module, and on the sentinel column past the end so a
        // run touching the right edge is not dropped.
        if (!dark && start !== -1) {
          found.push({ x: start, y: row, w: col - start });
          start = -1;
        }
      }
    }
    return { runs: found, module: m, count: n };
  }, [value, size]);

  return (
    <View
      style={{ width: size, height: size, backgroundColor: background }}
      accessibilityRole="image"
      accessibilityLabel={`QR code for ${value}`}
    >
      <View
        style={{
          position: "absolute",
          left: QUIET_ZONE * module,
          top: QUIET_ZONE * module,
          width: count * module,
          height: count * module,
        }}
      >
        {runs.map((r) => (
          <View
            key={`${r.y}-${r.x}`}
            style={{
              position: "absolute",
              left: r.x * module,
              top: r.y * module,
              width: r.w * module,
              height: module,
              backgroundColor: color,
            }}
          />
        ))}
      </View>
    </View>
  );
}
