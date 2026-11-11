// 由 public/assets/dollhouse/atlas.json 与 public/assets/dollhouse/room-layout.json 的运行时字段静态生成。
// 不要在 src 中 import public 目录文件，也不要在运行时 fetch；tests/house-data.test.ts 会逐项反查两边不漂移。
// 若 public JSON 更新，需同步更新本文件。

export const ATLAS = {
  logicalWidth: 801,
  wallAnchorsX: [34,762] as readonly [number, number],
  modules: [
    { id: "roof", logicalSize: [801,267] as readonly [number, number], topJoin: 183, bottomJoin: 256 },
    { id: "lobby", logicalSize: [801,282] as readonly [number, number], topJoin: 6, bottomJoin: 277 },
    { id: "floor-01", logicalSize: [801,287] as readonly [number, number], topJoin: 3, bottomJoin: 284 },
    { id: "floor-02", logicalSize: [801,284] as readonly [number, number], topJoin: 3, bottomJoin: 282 },
    { id: "floor-03", logicalSize: [801,282] as readonly [number, number], topJoin: 3, bottomJoin: 280 },
    { id: "floor-04", logicalSize: [801,283] as readonly [number, number], topJoin: 3, bottomJoin: 281 },
    { id: "floor-05", logicalSize: [801,286] as readonly [number, number], topJoin: 2, bottomJoin: 285 },
  ],
} as const;

export const ROOM_LAYOUT = {
  envelopes: {
    idleOrGreet: {"halfWidth":56,"height":137},
    choreWithTool: {"halfWidth":70,"height":180},
  },
  pairing: {
    minClearanceX: 8,
    leftStaysLeft: true,
    centerSharingX: [363,438] as readonly [number, number],
    greetingXs: [340,460] as readonly [number, number],
    workingXs: [326,474] as readonly [number, number],
  },
  floors: {
    "floor-01": {
      size: [801,287] as readonly [number, number],
      left: { idle: [292,254] as readonly [number, number], safe: [244,208,438,260] as readonly [number, number, number, number] },
      right: { idle: [532,254] as readonly [number, number], safe: [363,208,606,260] as readonly [number, number, number, number] },
      meetY: 254,
    },
    "floor-02": {
      size: [801,284] as readonly [number, number],
      left: { idle: [272,254] as readonly [number, number], safe: [204,204,438,260] as readonly [number, number, number, number] },
      right: { idle: [524,254] as readonly [number, number], safe: [363,204,586,260] as readonly [number, number, number, number] },
      meetY: 254,
    },
    "floor-03": {
      size: [801,282] as readonly [number, number],
      left: { idle: [264,252] as readonly [number, number], safe: [190,206,438,258] as readonly [number, number, number, number] },
      right: { idle: [528,252] as readonly [number, number], safe: [363,206,596,258] as readonly [number, number, number, number] },
      meetY: 252,
    },
    "floor-04": {
      size: [801,283] as readonly [number, number],
      left: { idle: [276,254] as readonly [number, number], safe: [210,204,438,260] as readonly [number, number, number, number] },
      right: { idle: [536,254] as readonly [number, number], safe: [363,204,612,260] as readonly [number, number, number, number] },
      meetY: 254,
    },
    "floor-05": {
      size: [801,286] as readonly [number, number],
      left: { idle: [272,256] as readonly [number, number], safe: [204,206,438,262] as readonly [number, number, number, number] },
      right: { idle: [528,256] as readonly [number, number], safe: [363,206,596,262] as readonly [number, number, number, number] },
      meetY: 256,
    },
  },
} as const;
