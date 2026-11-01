// The part of upng-js (no types of its own) the tools use.
declare module 'upng-js' {
  interface Frame {
    /** Milliseconds this frame shows for. */
    readonly delay: number;
  }
  interface Image {
    readonly width: number;
    readonly height: number;
    /** Empty for a still PNG. */
    readonly frames: readonly Frame[];
  }
  const UPNG: {
    decode(buffer: ArrayBuffer): Image;
    /** Every frame as RGBA, composited as a browser shows it. */
    toRGBA8(image: Image): ArrayBuffer[];
  };
  export default UPNG;
}
