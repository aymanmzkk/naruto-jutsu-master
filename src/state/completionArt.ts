/** Image rendered by the 3D world when a level is completed (data URL), shown on the completion screen. */
let art: string | null = null;
export const setCompletionArt = (url: string | null) => {
  art = url;
};
export const getCompletionArt = () => art;
