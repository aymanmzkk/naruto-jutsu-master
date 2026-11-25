/** Optional video file chosen by the user at runtime (kept for replays). */
let pickedVideo: File | null = null;
export const setPickedVideo = (f: File | null) => {
  pickedVideo = f;
};
export const getPickedVideo = () => pickedVideo;
