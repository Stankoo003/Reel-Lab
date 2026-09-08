# App icon export

Mark: two trim bars + play triangle. Colours: ground #0E0F12, accent #4C8DF6, play #F1F2F3.

## iOS
`ios/icon-*.png` — square, no rounded corners, no alpha. iOS applies the mask itself.
Drop `icon-1024.png` into an Expo config as `ios.icon`, or the full set into `Images.xcassets/AppIcon.appiconset`.

## Android
`android/ic_launcher-*.png` — legacy launcher icons, corners pre-rounded at 22%.
Adaptive (preferred): `adaptive-foreground-432.png` + `adaptive-background-432.png`.
Foreground is transparent and drawn at 62% so the mark stays inside the 66dp safe zone under any mask shape.
Expo: `android.adaptiveIcon.foregroundImage` / `.backgroundColor: "#0E0F12"`.

## Variants
`variants/icon-inverted-1024.png` — accent ground.
`variants/icon-monochrome-light-1024.png` — dark mark on light ground.
`variants/icon-monochrome-white-transparent-1024.png` — white mark, transparent (notification / tinted).

`icon-master.svg` is the source. Re-export from it rather than upscaling any PNG.
