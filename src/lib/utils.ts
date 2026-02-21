import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const FACEHASH_COLORS = [
  // Reds
  "#ff1744", "#ff5252", "#ff6b6b", "#e53935",
  // Pinks / Magentas
  "#f50057", "#e91e63", "#ff4081", "#ff00ff",
  // Purples
  "#9c27b0", "#aa00ff", "#ab47bc", "#ce93d8",
  // Deep Purples
  "#673ab7", "#7c4dff", "#651fff", "#d500f9",
  // Indigo
  "#3f51b5", "#3d5afe", "#536dfe", "#8c9eff",
  // Blues
  "#2196f3", "#1e88e5", "#448aff", "#2979ff",
  // Light Blues / Cyan
  "#03a9f4", "#00bcd4", "#00e5ff", "#18ffff",
  // Teals
  "#009688", "#00bfa5", "#1de9b6", "#00e676",
  // Greens
  "#4caf50", "#43a047", "#69f0ae", "#00c853",
  // Lime / Yellow-green
  "#8bc34a", "#76ff03", "#c6ff00", "#aeea00",
  // Yellows / Ambers
  "#ffeb3b", "#ffd600", "#ffab00", "#ff6f00",
  // Oranges / Deep Oranges
  "#ff9800", "#ff6d00", "#ff5722", "#ff3d00",
];
